import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { planFor } from "@sv/shared";
import { normalizeShopSettings, usage } from "@sv/core";
import prisma from "../db.server";
import { adminContext } from "../lib/context.server";

/** Setup checklist with deep links into the theme editor (feature 70). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const shopId = ctx.shop.id;
  const [ready, tagged, published, use] = await Promise.all([
    prisma.video.count({ where: { shopId, status: "ready" } }),
    prisma.videoProduct.count({ where: { video: { shopId } } }),
    prisma.widget.findFirst({ where: { shopId, status: "published" }, orderBy: { publishedAt: "desc" } }),
    usage(ctx.shop),
  ]);
  const settings = normalizeShopSettings(ctx.shop.settings);
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const editor = `https://${ctx.session.shop}/admin/themes/current/editor`;
  return {
    plan: planFor(ctx.shop.plan).name,
    usage: use,
    widgetHandle: published?.handle ?? null,
    steps: {
      upload: ready > 0,
      tag: tagged > 0,
      widget: Boolean(published),
      embed: settings.onboarding.embedEnabled === true,
      block: settings.onboarding.blockAdded === true,
    },
    dismissed: settings.onboarding.dismissed === true,
    links: {
      embed: `${editor}?context=apps&activateAppId=${apiKey}/sv-embed`,
      homeBlock: `${editor}?template=index&addAppBlockId=${apiKey}/sv-widget&target=newAppsSection`,
      productBlock: `${editor}?template=product&addAppBlockId=${apiKey}/sv-product-videos&target=mainSection`,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const raw = (ctx.shop.settings ?? {}) as Record<string, unknown>;
  const onboarding = { ...((raw.onboarding as Record<string, boolean>) ?? {}) };
  const step = String(form.get("step"));
  if (["embedEnabled", "blockAdded", "dismissed"].includes(step)) onboarding[step] = form.get("value") !== "false";
  await prisma.shop.update({ where: { id: ctx.shop.id }, data: { settings: { ...raw, onboarding } } });
  return { ok: true };
};

function Mark({ step, done }: { step: string; done: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="value" value={done ? "false" : "true"} />
      <s-button type="submit" variant="tertiary">
        {done ? "Mark as not done" : "Mark as done"}
      </s-button>
    </Form>
  );
}

function Step(props: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="inline" gap="base" alignItems="start">
        <s-badge tone={props.done ? "success" : "neutral"}>{props.done ? "Done" : `Step ${props.n}`}</s-badge>
        <s-stack gap="small-200">
          <s-heading>{props.title}</s-heading>
          {props.children}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const s = d.steps;
  const doneCount = Object.values(s).filter(Boolean).length;

  return (
    <s-page heading="Shoppable videos">
      <s-section heading={`Set up your store (${doneCount} of 5)`}>
        <s-stack gap="base">
          <Step n={1} done={s.upload} title="Add videos">
            <s-paragraph>Upload from your device or import from Instagram and TikTok.</s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button href="/app/videos">Upload videos</s-button>
              <s-button href="/app/import" variant="tertiary">
                Import
              </s-button>
            </s-stack>
          </Step>
          <Step n={2} done={s.tag} title="Tag products">
            <s-paragraph>Open a video and tag the products in it, so shoppers can buy from the video.</s-paragraph>
            <s-button href="/app/videos">Go to videos</s-button>
          </Step>
          <Step n={3} done={s.widget} title="Create and publish a widget">
            <s-paragraph>Pick a layout (carousel, stories, grid, featured or pop-up), add videos, then publish.</s-paragraph>
            <s-button href="/app/widgets">Create a widget</s-button>
          </Step>
          <Step n={4} done={s.embed} title="Turn on the app embed">
            <s-paragraph>Needed for the pop-up, custom CSS and page-builder embeds. Turn on &quot;Shoppable videos&quot; and save.</s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button href={d.links.embed} target="_top">
                Open theme editor
              </s-button>
              <Mark step="embedEnabled" done={s.embed} />
            </s-stack>
          </Step>
          <Step n={5} done={s.block} title="Add a widget to a page">
            <s-paragraph>
              Add the &quot;Shoppable videos&quot; block and paste the widget&apos;s block id
              {d.widgetHandle ? (
                <>
                  {" "}
                  (<code>{d.widgetHandle}</code>)
                </>
              ) : null}
              . On product pages, the &quot;Product videos&quot; block fills itself from tagged videos.
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button href={d.links.homeBlock} target="_top">
                Add to home page
              </s-button>
              <s-button href={d.links.productBlock} target="_top" variant="tertiary">
                Add to product pages
              </s-button>
              <Mark step="blockAdded" done={s.block} />
            </s-stack>
          </Step>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Your plan">
        <s-paragraph>
          {d.plan} plan.{" "}
          {d.usage.limit === null ? `${d.usage.used} videos.` : `${d.usage.used} of ${d.usage.limit} videos used.`}
        </s-paragraph>
        <s-button href="/app/plans" variant="tertiary">
          See plans
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
