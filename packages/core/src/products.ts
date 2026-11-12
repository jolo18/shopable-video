import type { ShopifyClient } from "./shopify/client";

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string | null;
  imageUrl: string | null;
  /** Minor units */
  price: number;
  compareAtPrice: number | null;
  hasOptions: boolean;
  variantId: string | null;
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
        hasOnlyDefaultVariant
        priceRangeV2 { minVariantPrice { amount } }
        compareAtPriceRange { maxVariantCompareAtPrice { amount } }
        variants(first: 1) { nodes { id } }
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
              price: cents(n.priceRangeV2?.minVariantPrice?.amount) ?? 0,
              compareAtPrice: cents(n.compareAtPriceRange?.maxVariantCompareAtPrice?.amount),
              hasOptions: n.hasOnlyDefaultVariant === false,
              variantId: n.variants?.nodes?.[0]?.id ?? null,
            }
          : { id, title: "Deleted product", handle: "", status: null, imageUrl: null, price: 0, compareAtPrice: null, hasOptions: false, variantId: null },
      );
    });
  }
  return out;
}

function cents(amount: string | undefined | null): number | null {
  if (amount === undefined || amount === null) return null;
  const n = Math.round(Number(amount) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}
