import type { ShopifyClient } from "./shopify/client";

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string | null;
  imageUrl: string | null;
}

const NODES = `#graphql
  query svProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
        featuredMedia { preview { image { url } } }
      }
    }
  }`;

/** Titles and images for the admin. Deleted products come back as missing. */
export async function productSummaries(client: ShopifyClient, ids: string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];
  const out: ProductSummary[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await client.request(NODES, { ids: chunk });
    chunk.forEach((id, j) => {
      const n = data.nodes[j];
      out.push(
        n
          ? {
              id: n.id,
              title: n.title,
              handle: n.handle,
              status: n.status,
              imageUrl: n.featuredMedia?.preview?.image?.url ?? null,
            }
          : { id, title: "Deleted product", handle: "", status: null, imageUrl: null },
      );
    });
  }
  return out;
}
