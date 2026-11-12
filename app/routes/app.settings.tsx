import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DEFAULT_STRINGS, STRING_KEYS, type StringKey } from "@sv/shared";
import { normalizeShopSettings } from "@sv/core";
import prisma from "../db.server";
import { adminContext } from "../lib/context.server";
import { publisherFor } from "../lib/publishing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? "en").toLowerCase();
  return { settings: normalizeShopSettings(ctx.shop.settings), locale };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const raw = (ctx.shop.settings ?? {}) as Record<string, unknown>;
  const current = normalizeShopSettings(raw);
  const locale = String(form.get("locale") ?? "en").toLowerCase();

  const overrides: Record<string, string> = {};
  for (const k of STRING_KEYS) {
    const v = String(form.get(`t.${k}`) ?? "").trim();
    if (v) overrides[k] = v;
  }
  const translations = { ...current.translations, [locale]: overrides };
  if (Object.keys(overrides).length === 0) delete translations[locale];

  const next = normalizeShopSettings({
    ...raw,
    cartMode: form.get("cartMode"),
    customCss: String(form.get("customCss") ?? ""),
    translations,
  });
  await prisma.shop.update({
    where: { id: ctx.shop.id },
    // Keep fields normalize doesn't know about (storefront token).
    data: { settings: { ...raw, ...next } },
  });
  await publisherFor({ ...ctx, shop: { ...ctx.shop, settings: { ...raw, ...next } } }).publishConfig();
  return { ok: true };
};

export default function Settings() {
  const { settings, locale } = useLoaderData<typeof loader>();
  const saved = useActionData<typeof action>();
  const nav = useNavigation();
  const lang = locale.split("-")[0];
  const defaults = { ...DEFAULT_STRINGS.en, ...(DEFAULT_STRINGS[lang] ?? {}) };
  const overrides = settings.translations[locale] ?? {};

  return (
    <s-page heading="Settings">
      {saved?.ok && <s-banner tone="success">Saved and published to your store.</s-banner>}
      <Form method="post">
        <input type="hidden" name="locale" value={locale} />
        <s-stack gap="base">
          <s-section heading="After add to cart">
            <s-select name="cartMode" label="When a shopper adds to cart from a video" value={settings.cartMode}>
              <s-option value="drawer">Open the theme&apos;s cart drawer (falls back to updating the cart count)</s-option>
              <s-option value="cart_page">Go to the cart page</s-option>
              <s-option value="stay">Stay in the video and show &quot;Added&quot;</s-option>
            </s-select>
          </s-section>

          <s-section heading="Custom CSS">
            <s-text-area
              name="customCss"
              label="CSS added to every page with the app embed on. Target .sv-root and its children."
              rows={8}
              defaultValue={settings.customCss}
              maxLength={20000}
            />
          </s-section>

          <s-section heading="Storefront text">
            <s-paragraph>
              Shoppers see text in your store&apos;s language. English, French, Spanish and German are built in; override any text per
              language here. Editing: <code>{locale}</code>.{" "}
              {["en", "fr", "es", "de"].map((l) => (
                <span key={l}>
                  <s-link href={`?locale=${l}`}>{l}</s-link>{" "}
                </span>
              ))}
            </s-paragraph>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
              {STRING_KEYS.map((k: StringKey) => (
                <s-text-field key={k} name={`t.${k}`} label={k.replace(/_/g, " ")} placeholder={defaults[k]} defaultValue={overrides[k] ?? ""} maxLength={120} />
              ))}
            </s-grid>
          </s-section>

          <s-button type="submit" variant="primary" {...(nav.state === "submitting" ? { loading: true } : {})}>
            Save
          </s-button>
        </s-stack>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
