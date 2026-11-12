import type { ActionFunctionArgs } from "react-router";
import { applySubscriptionWebhook } from "@sv/core";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  await applySubscriptionWebhook(shop, payload as { app_subscription?: { name?: string; status?: string } });
  return new Response();
};
