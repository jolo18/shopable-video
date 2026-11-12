import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { WIDGET_TYPES, WIDGET_TYPE_LABELS } from "@sv/shared";
import { createWidget, listWidgets } from "@sv/core";
import { adminContext, jsonError } from "../lib/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await adminContext(request);
  const widgets = await listWidgets(shop.id);
  return {
    widgets: widgets.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      handle: w.handle,
      status: w.status,
      dirty: w.dirty,
      videos: w._count.videos,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  if (form.get("intent") === "create") {
    try {
      const w = await createWidget(ctx.shop.id, {
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? "carousel"),
      });
      return ctx.redirect(`/app/widgets/${w.id}`);
    } catch (err) {
      return jsonError((err as Error).message);
    }
  }
  return jsonError("Unknown action");
};

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Widgets">
      <s-section heading="New widget">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field name="name" label="Name" placeholder="Homepage carousel" required />
            <s-select name="type" label="Layout">
              {WIDGET_TYPES.map((t) => (
                <s-option key={t} value={t}>
                  {WIDGET_TYPE_LABELS[t]}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary">
              Create
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section padding="none">
        {widgets.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No widgets yet. Create one, add videos, then publish it and add the block in your theme.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Layout</s-table-header>
              <s-table-header>Videos</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Theme block id</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {widgets.map((w) => (
                <s-table-row key={w.id}>
                  <s-table-cell>
                    <Link to={`/app/widgets/${w.id}`}>{w.name}</Link>
                  </s-table-cell>
                  <s-table-cell>{WIDGET_TYPE_LABELS[w.type as keyof typeof WIDGET_TYPE_LABELS] ?? w.type}</s-table-cell>
                  <s-table-cell>{w.videos}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={w.status === "published" ? (w.dirty ? "warning" : "success") : "neutral"}>
                      {w.status === "published" ? (w.dirty ? "Unpublished changes" : "Published") : "Draft"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <code>{w.handle}</code>
                  </s-table-cell>
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
