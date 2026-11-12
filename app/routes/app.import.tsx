import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { entitlementsFor } from "@sv/shared";
import {
  EntitlementError,
  PlanLimitError,
  ProviderError,
  RightsNotConfirmed,
  connectAccount,
  providerFromEnv,
  queueLinkImports,
  queuePostImports,
  type Platform,
  type SocialPost,
} from "@sv/core";
import prisma from "../db.server";
import { adminContext, jsonError } from "../lib/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await adminContext(request);
  const [jobs, accounts] = await Promise.all([
    prisma.importJob.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.socialAccount.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    autoSyncAllowed: entitlementsFor(shop.plan).autoSync,
    jobs: jobs.map((j) => ({ id: j.id, url: j.sourceUrl, status: j.status, error: j.error, videoId: j.videoId, createdAt: j.createdAt.toISOString() })),
    accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, username: a.username, autoSync: a.autoSync, lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const rights = form.get("rights") === "on";
  try {
    if (intent === "links") {
      const urls = String(form.get("urls") ?? "").split(/\s+/);
      const jobs = await queueLinkImports(ctx.shop, urls, rights);
      return { ok: true, message: `Importing ${jobs.length} video${jobs.length === 1 ? "" : "s"}` };
    }
    if (intent === "browse") {
      const platform = String(form.get("platform")) as Platform;
      const username = String(form.get("username") ?? "");
      const posts = await providerFromEnv().listProfile(platform, username, 24);
      return { ok: true, posts, platform, username };
    }
    if (intent === "import_posts") {
      const posts = JSON.parse(String(form.get("posts") ?? "[]")) as SocialPost[];
      const picked = form.getAll("pick").map(String);
      const chosen = posts.filter((p) => picked.includes(p.externalId));
      const jobs = await queuePostImports(ctx.shop, chosen, rights);
      return { ok: true, message: `Importing ${jobs.length} video${jobs.length === 1 ? "" : "s"}` };
    }
    if (intent === "connect") {
      await connectAccount(ctx.shop, {
        platform: String(form.get("platform")) as Platform,
        username: String(form.get("username") ?? ""),
        autoSync: form.get("autoSync") === "on",
        rightsConfirmed: rights,
      });
      return { ok: true, message: "Account saved" };
    }
    if (intent === "disconnect") {
      await prisma.socialAccount.deleteMany({ where: { id: String(form.get("id")), shopId: ctx.shop.id } });
      return { ok: true, message: "Account removed" };
    }
  } catch (err) {
    if (err instanceof RightsNotConfirmed || err instanceof ProviderError || err instanceof PlanLimitError || err instanceof EntitlementError) {
      return jsonError(err.message);
    }
    throw err;
  }
  return jsonError("Unknown action");
};

const TONE: Record<string, "success" | "info" | "critical" | "neutral" | "warning"> = {
  done: "success",
  duplicate: "neutral",
  failed: "critical",
  queued: "info",
  fetching: "info",
  uploading: "info",
};

function Rights() {
  return (
    <s-checkbox
      name="rights"
      value="on"
      label="I own these videos or have the creator's permission to use them in my store"
      required
    />
  );
}

export default function Import() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as
    | { ok: true; message?: string; posts?: SocialPost[]; platform?: string; username?: string }
    | { ok: false; error: string }
    | undefined;
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const busy = nav.state === "submitting";
  const active = data.jobs.some((j) => ["queued", "fetching", "uploading"].includes(j.status));

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(t);
  }, [active, revalidator]);

  return (
    <s-page heading="Import from Instagram and TikTok">
      <s-link slot="breadcrumb-actions" href="/app/videos">
        Videos
      </s-link>
      {result && !result.ok && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.ok && result.message && <s-banner tone="success">{result.message}</s-banner>}

      <s-section heading="Paste links">
        <Form method="post">
          <input type="hidden" name="intent" value="links" />
          <s-stack gap="base">
            <s-text-area name="urls" label="Reel or TikTok links, one per line" rows={4} placeholder="https://www.instagram.com/reel/..." />
            <Rights />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
              Import
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Browse a profile">
        <Form method="post">
          <input type="hidden" name="intent" value="browse" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-select name="platform" label="Platform">
              <s-option value="instagram">Instagram</s-option>
              <s-option value="tiktok">TikTok</s-option>
            </s-select>
            <s-text-field name="username" label="Username" placeholder="@yourbrand" required />
            <s-button type="submit">Show videos</s-button>
          </s-stack>
        </Form>
        {result?.ok && result.posts && (
          <Form method="post">
            <input type="hidden" name="intent" value="import_posts" />
            <input type="hidden" name="posts" value={JSON.stringify(result.posts)} />
            <s-stack gap="base">
              <s-text>
                {result.posts.length} recent videos from @{result.username}
              </s-text>
              <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
                {result.posts.map((p) => (
                  <s-box key={p.externalId} padding="small-200" borderWidth="base" borderRadius="base">
                    <s-stack gap="small-200">
                      {p.thumbnailUrl && <s-image src={p.thumbnailUrl} alt="" aspectRatio="9/16" objectFit="cover" />}
                      <s-checkbox name="pick" value={p.externalId} label={p.caption.slice(0, 60) || p.externalId} />
                    </s-stack>
                  </s-box>
                ))}
              </s-grid>
              <Rights />
              <s-button type="submit" variant="primary">
                Import selected
              </s-button>
            </s-stack>
          </Form>
        )}
      </s-section>

      <s-section heading="Connected accounts">
        <s-paragraph>
          {data.autoSyncAllowed
            ? "With auto-sync on, new videos from the account are imported once a day."
            : "Daily auto-sync is on the Growth and Pro plans. You can still save accounts to browse them."}
        </s-paragraph>
        <s-stack gap="small-200">
          {data.accounts.map((a) => (
            <Form method="post" key={a.id}>
              <input type="hidden" name="intent" value="disconnect" />
              <input type="hidden" name="id" value={a.id} />
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>
                  {a.platform} @{a.username}
                </s-text>
                <s-badge tone={a.autoSync ? "success" : "neutral"}>{a.autoSync ? "Auto-sync on" : "Manual"}</s-badge>
                {a.lastSyncedAt && <s-text tone="neutral">Last synced {new Date(a.lastSyncedAt).toLocaleString()}</s-text>}
                <s-button type="submit" variant="tertiary" tone="critical">
                  Remove
                </s-button>
              </s-stack>
            </Form>
          ))}
        </s-stack>
        <Form method="post">
          <input type="hidden" name="intent" value="connect" />
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select name="platform" label="Platform">
                <s-option value="instagram">Instagram</s-option>
                <s-option value="tiktok">TikTok</s-option>
              </s-select>
              <s-text-field name="username" label="Username" required />
            </s-stack>
            <s-checkbox name="autoSync" value="on" label="Import new videos daily" disabled={!data.autoSyncAllowed} />
            <Rights />
            <s-button type="submit">Save account</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Recent imports">
        {data.jobs.length === 0 ? (
          <s-paragraph>No imports yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Link</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Video</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.jobs.map((j) => (
                <s-table-row key={j.id}>
                  <s-table-cell>{j.url}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={TONE[j.status] ?? "neutral"}>{j.status === "duplicate" ? "already in library" : j.status}</s-badge>
                    {j.error && <s-text tone={j.status === "failed" ? "critical" : "neutral"}> {j.error}</s-text>}
                  </s-table-cell>
                  <s-table-cell>{j.videoId ? <s-link href={`/app/videos/${j.videoId}`}>Open</s-link> : "–"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
