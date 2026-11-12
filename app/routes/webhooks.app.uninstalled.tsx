import type { ActionFunctionArgs } from "react-router";
import { markUninstalled } from "@sv/core";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  // Webhooks can arrive more than once; markUninstalled is idempotent.
  await markUninstalled(shop);
  return new Response();
};
