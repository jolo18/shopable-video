import type { ActionFunctionArgs } from "react-router";
import { redactCustomerOrders, redactShop } from "@sv/core";
import { authenticate } from "../shopify.server";

/**
 * The three mandatory privacy webhooks (plan, build rules).
 * authenticate.webhook verifies the HMAC and answers 401 when it is wrong.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // We store no customer names, emails or addresses; visitors are keyed
      // by Shopify's anonymous client id, which we cannot map to a customer.
      // Nothing to return to the merchant.
      break;
    case "CUSTOMERS_REDACT": {
      const orders = (payload as { orders_to_redact?: Array<number | string> })
        .orders_to_redact;
      await redactCustomerOrders(shop, orders ?? []);
      break;
    }
    case "SHOP_REDACT":
      await redactShop(shop);
      break;
    default:
      return new Response("Unhandled topic", { status: 404 });
  }
  return new Response();
};
