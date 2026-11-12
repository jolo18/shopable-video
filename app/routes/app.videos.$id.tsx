import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { entitlementsFor } from "@sv/shared";
import {
  attachCover,
  clearCover,
  getVideo,
  startCoverUpload,
  UploadRejected,
  updateVideoDetails,
} from "@sv/core";
import { adminContext, jsonError } from "../lib/context.server";
import { deleteAndUnpublish, publishVideoChange, saveVideoProducts, productSummaries } from "../lib/publishing.server";
import { putToTarget } from "../components/uploader";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const video = await getVideo(ctx.shop.id, params.id!);
  if (!video) throw new Response("Not found", { status: 404 });
  const products = await productSummaries(ctx, video.products.map((p) => p.productId));
  const sources = (video.sources as Array<{ url: string; mimeType: string; width: number }>) ?? [];
  const mp4 = sources.filter((s) => s.mimeType === "video/mp4").sort((a, b) => a.width - b.width)[0];
  return {
    video: {
      id: video.id,
      title: video.title,
      caption: video.caption,
      status: video.status,
      error: video.error,
      posterUrl: video.coverUrl ?? video.posterUrl,
      hasCover: Boolean(video.coverFileId),
      previewUrl: mp4?.url ?? null,
      source: video.source,
      sourceUrl: video.sourceUrl,
    },
    products,
    multiTag: entitlementsFor(ctx.shop.plan).multiTag,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const id = params.id!;
  const isJson = request.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await request.json() : Object.fromEntries(await request.formData());

  try {
    switch (body.intent) {
      case "details":
        await updateVideoDetails(ctx.shop.id, id, { title: String(body.title ?? ""), caption: String(body.caption ?? "") });
        await publishVideoChange(ctx, id);
        return { ok: true, saved: true };
      case "cover_target": {
        const target = await startCoverUpload(body.file, ctx.store);
        return { ok: true, target };
      }
      case "cover_attach":
        await attachCover(ctx.shop.id, id, String(body.resourceUrl), ctx.store);
        await publishVideoChange(ctx, id);
        return { ok: true };
      case "cover_clear":
        await clearCover(ctx.shop.id, id);
        await publishVideoChange(ctx, id);
        return { ok: true };
      case "products": {
        const ids: string[] = Array.isArray(body.productIds) ? body.productIds : [];
        await saveVideoProducts(ctx, id, ids);
        return { ok: true };
      }
      case "delete":
        await deleteAndUnpublish(ctx, [id]);
        return ctx.redirect("/app/videos");
    }
  } catch (err) {
    if (err instanceof UploadRejected || (err as Error).name === "EntitlementError") return jsonError((err as Error).message);
    throw err;
  }
  return jsonError("Unknown action");
};

async function postJson(body: unknown) {
  const res = await fetch(window.location.pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? "Request failed");
  return json;
}

export default function VideoDetail() {
  const { video, products, multiTag } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const coverInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) shopify.toast.show(done);
      revalidator.revalidate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCover(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    await run(async () => {
      const { target } = await postJson({
        intent: "cover_target",
        file: { filename: file.name, mimeType: file.type, size: file.size },
      });
      await putToTarget(target, file, () => {});
      await postJson({ intent: "cover_attach", resourceUrl: target.resourceUrl });
    }, "Cover updated");
  }

  async function pickProducts() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: multiTag ? 10 : false,
      action: "select",
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    const ids = selected.map((p: { id: string }) => p.id);
    await run(() => postJson({ intent: "products", productIds: ids }), "Products saved");
  }

  async function removeProduct(id: string) {
    await run(
      () => postJson({ intent: "products", productIds: products.map((p) => p.id).filter((p) => p !== id) }),
      "Product removed",
    );
  }

  async function moveProduct(index: number, dir: -1 | 1) {
    const ids = products.map((p) => p.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await run(() => postJson({ intent: "products", productIds: ids }));
  }

  return (
    <s-page heading={video.title || "Untitled video"}>
      <s-link slot="breadcrumb-actions" href="/app/videos">
        Videos
      </s-link>
      {error && <s-banner tone="critical">{error}</s-banner>}
      {video.status !== "ready" && (
        <s-banner tone={video.status === "failed" ? "critical" : "info"}>
          {video.status === "failed" ? `Processing failed: ${video.error ?? "unknown error"}` : "Shopify is still processing this video."}
        </s-banner>
      )}

      <s-section heading="Details">
        <Form method="post">
          <input type="hidden" name="intent" value="details" />
          <s-stack gap="base">
            <s-text-field name="title" label="Title" defaultValue={video.title} maxLength={120} />
            <s-text-area name="caption" label="Caption" defaultValue={video.caption} maxLength={2000} rows={3} />
            <s-button type="submit" variant="primary" {...(nav.state === "submitting" ? { loading: true } : {})}>
              Save
            </s-button>
            {actionData && "saved" in actionData && <s-text tone="success">Saved</s-text>}
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Products">
        <s-paragraph>
          {multiTag
            ? "Tag up to 10 products. Shoppers can add them to cart from the video."
            : "Your plan tags one product per video. Upgrade to tag several."}
        </s-paragraph>
        <s-stack gap="small-200">
          {products.map((p, i) => (
            <s-stack key={p.id} direction="inline" gap="base" alignItems="center">
              <s-thumbnail src={p.imageUrl ?? undefined} alt={p.title} size="small" />
              <s-text>{p.title}</s-text>
              {p.status !== "ACTIVE" && <s-badge tone="warning">{p.status?.toLowerCase() ?? "missing"}</s-badge>}
              {multiTag && products.length > 1 && (
                <>
                  <s-button variant="tertiary" accessibilityLabel="Move up" onClick={() => moveProduct(i, -1)}>
                    ↑
                  </s-button>
                  <s-button variant="tertiary" accessibilityLabel="Move down" onClick={() => moveProduct(i, 1)}>
                    ↓
                  </s-button>
                </>
              )}
              <s-button variant="tertiary" tone="critical" onClick={() => removeProduct(p.id)}>
                Remove
              </s-button>
            </s-stack>
          ))}
          <s-button onClick={pickProducts} {...(busy ? { loading: true } : {})}>
            {products.length ? "Change products" : "Tag products"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        {video.previewUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={video.previewUrl}
            poster={video.posterUrl ?? undefined}
            controls
            muted
            playsInline
            style={{ width: "100%", borderRadius: 8, aspectRatio: "9 / 16", objectFit: "cover", background: "#000" }}
          />
        ) : (
          <s-paragraph>The preview appears once processing finishes.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Cover image">
        <s-paragraph>Shown before the video plays. Defaults to Shopify&apos;s preview frame.</s-paragraph>
        {video.posterUrl && <s-thumbnail src={video.posterUrl} alt="Cover" size="large" />}
        <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onCover(e.currentTarget.files)} />
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={() => coverInput.current?.click()} {...(busy ? { loading: true } : {})}>
            Upload cover
          </s-button>
          {video.hasCover && <s-button variant="tertiary" onClick={() => run(() => postJson({ intent: "cover_clear" }), "Cover removed")}>Use default</s-button>}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Danger zone">
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <s-button type="submit" tone="critical">
            Delete video
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
