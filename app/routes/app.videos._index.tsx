import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  abandonUpload,
  finalizeUpload,
  listVideos,
  PlanLimitError,
  startUploads,
  UploadRejected,
  usage,
  type ListFilters,
} from "@sv/core";
import { adminContext, jsonError } from "../lib/context.server";
import { deleteAndUnpublish } from "../lib/publishing.server";
import { uploadVideos, type UploadProgress } from "../components/uploader";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await adminContext(request);
  const url = new URL(request.url);
  const filters: ListFilters = {
    q: url.searchParams.get("q") ?? "",
    status: (url.searchParams.get("status") ?? "") as ListFilters["status"],
    source: url.searchParams.get("source") ?? "",
    tagged: (url.searchParams.get("tagged") ?? "") as ListFilters["tagged"],
    sort: (url.searchParams.get("sort") ?? "newest") as ListFilters["sort"],
    page: Number(url.searchParams.get("page") ?? 1),
  };
  const [list, use] = await Promise.all([listVideos(shop.id, filters), usage(shop)]);
  return {
    usage: use,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    videos: list.videos.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      source: v.source,
      error: v.error,
      posterUrl: v.coverUrl ?? v.posterUrl,
      products: v.products.length,
      widgets: v._count.widgets,
      durationMs: v.durationMs,
      createdAt: v.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const isJson = request.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await request.json() : Object.fromEntries(await request.formData());
  const intent = body.intent;

  try {
    if (intent === "start_uploads") {
      const uploads = await startUploads(ctx.shop, body.files ?? [], ctx.store);
      return { ok: true, uploads };
    }
    if (intent === "finalize") {
      await finalizeUpload(ctx.shop.id, String(body.videoId), String(body.resourceUrl), ctx.store);
      return { ok: true };
    }
    if (intent === "abandon") {
      await abandonUpload(ctx.shop.id, String(body.videoId), String(body.reason ?? "Upload failed"));
      return { ok: true };
    }
    if (intent === "delete") {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : String(body.ids ?? "").split(",").filter(Boolean);
      const result = await deleteAndUnpublish(ctx, ids);
      return { ok: true, deleted: result.deleted.length };
    }
  } catch (err) {
    if (err instanceof UploadRejected || err instanceof PlanLimitError) return jsonError(err.message);
    throw err;
  }
  return jsonError("Unknown action");
};

const STATUS_TONE: Record<string, "success" | "info" | "critical" | "neutral"> = {
  ready: "success",
  processing: "info",
  uploading: "info",
  failed: "critical",
};

export default function Videos() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const busy = data.videos.some((v) => v.status === "processing" || v.status === "uploading");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(t);
  }, [busy, revalidator]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploadError(null);
    try {
      await uploadVideos("/app/videos?index", Array.from(list), setUploads);
    } catch (err) {
      setUploadError((err as Error).message);
    }
    revalidator.revalidate();
    if (fileInput.current) fileInput.current.value = "";
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const limitText =
    data.usage.limit === null ? `${data.usage.used} videos` : `${data.usage.used} of ${data.usage.limit} videos`;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams(params);
    sp.set("page", String(p));
    return `?${sp}`;
  };

  return (
    <s-page heading="Videos">
      <s-button slot="primary-action" variant="primary" onClick={() => fileInput.current?.click()}>
        Upload videos
      </s-button>
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        hidden
        onChange={(e) => onFiles(e.currentTarget.files)}
      />
      <s-link slot="secondary-actions" href="/app/import">
        Import from Instagram or TikTok
      </s-link>

      {uploadError && (
        <s-banner tone="critical" heading="Upload not started">
          {uploadError}
        </s-banner>
      )}

      {uploads.length > 0 && (
        <s-section heading="Uploads">
          <s-stack gap="small-200">
            {uploads.map((u, i) => (
              <s-stack key={i} direction="inline" gap="base" alignItems="center">
                <s-text>{u.filename}</s-text>
                <s-badge tone={u.state === "error" ? "critical" : u.state === "done" ? "success" : "info"}>
                  {u.state === "uploading" ? `${Math.round(u.progress * 100)}%` : u.state}
                </s-badge>
                {u.error && <s-text tone="critical">{u.error}</s-text>}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section>
        <Form method="get">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-search-field name="q" label="Search" labelAccessibilityVisibility="exclusive" placeholder="Search videos" defaultValue={params.get("q") ?? ""} />
            <s-select name="status" label="Status" value={params.get("status") ?? ""}>
              <s-option value="">Any status</s-option>
              <s-option value="ready">Ready</s-option>
              <s-option value="processing">Processing</s-option>
              <s-option value="failed">Failed</s-option>
            </s-select>
            <s-select name="source" label="Source" value={params.get("source") ?? ""}>
              <s-option value="">Any source</s-option>
              <s-option value="upload">Uploaded</s-option>
              <s-option value="instagram">Instagram</s-option>
              <s-option value="tiktok">TikTok</s-option>
            </s-select>
            <s-select name="tagged" label="Products" value={params.get("tagged") ?? ""}>
              <s-option value="">Tagged or not</s-option>
              <s-option value="tagged">Tagged</s-option>
              <s-option value="untagged">Not tagged</s-option>
            </s-select>
            <s-select name="sort" label="Sort" value={params.get("sort") ?? "newest"}>
              <s-option value="newest">Newest</s-option>
              <s-option value="oldest">Oldest</s-option>
              <s-option value="title">Title</s-option>
            </s-select>
            <s-button type="submit">Filter</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section padding="none">
        <s-stack direction="inline" gap="base" padding="base" alignItems="center">
          <s-text>{limitText}</s-text>
          {selected.size > 0 && (
            <Form method="post" onSubmit={() => setSelected(new Set())}>
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="ids" value={[...selected].join(",")} />
              <s-button type="submit" tone="critical">
                Delete {selected.size} selected
              </s-button>
            </Form>
          )}
        </s-stack>
        {data.videos.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No videos yet. Upload MP4, MOV or WebM files up to 1 GB and 10 minutes.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Select</s-table-header>
              <s-table-header>Video</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header>Widgets</s-table-header>
              <s-table-header>Source</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.videos.map((v) => (
                <s-table-row key={v.id}>
                  <s-table-cell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${v.title || "video"}`}
                      checked={selected.has(v.id)}
                      onChange={() => toggle(v.id)}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-thumbnail src={v.posterUrl ?? undefined} alt={v.title} size="small" />
                      <Link to={`/app/videos/${v.id}`}>{v.title || "Untitled"}</Link>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status}</s-badge>
                    {v.error && <s-text tone="critical"> {v.error}</s-text>}
                  </s-table-cell>
                  <s-table-cell>{v.products}</s-table-cell>
                  <s-table-cell>{v.widgets}</s-table-cell>
                  <s-table-cell>{v.source}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {pages > 1 && (
          <s-stack direction="inline" gap="base" padding="base">
            {data.page > 1 && <s-link href={pageHref(data.page - 1)}>Previous</s-link>}
            <s-text>
              Page {data.page} of {pages}
            </s-text>
            {data.page < pages && <s-link href={pageHref(data.page + 1)}>Next</s-link>}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
