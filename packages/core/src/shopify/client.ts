/**
 * Shopify client (plan, C3): GraphQL with retries and rate-limit backoff.
 * Every write to Shopify goes through the Publisher and this client.
 *
 * Works on top of any `admin.graphql` from @shopify/shopify-app-react-router
 * (admin requests in the app server, unauthenticated.admin in the worker),
 * or a plain fetch transport in tests.
 */

export interface GraphqlResponseBody<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/** Matches the shape of admin.graphql from the Shopify app library. */
export type AdminGraphqlFn = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface ShopifyClient {
  shop: string;
  /** Returns `data`, throws ShopifyError on GraphQL errors. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<T = any>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export class ShopifyError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

export class UserErrorsError extends Error {
  constructor(
    public readonly operation: string,
    public readonly userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>,
  ) {
    super(
      `${operation}: ${userErrors.map((e) => `${(e.field ?? []).join(".")} ${e.message}`.trim()).join("; ")}`,
    );
    this.name = "UserErrorsError";
  }
}

/** Throws when a mutation payload has userErrors. */
export function assertNoUserErrors(
  operation: string,
  payload: { userErrors?: Array<{ field?: string[] | null; message: string; code?: string | null }> } | null | undefined,
): void {
  if (payload?.userErrors?.length) {
    throw new UserErrorsError(operation, payload.userErrors);
  }
}

export interface ClientOptions {
  maxRetries?: number;
  /** For tests */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createShopifyClient(
  shop: string,
  graphql: AdminGraphqlFn,
  opts: ClientOptions = {},
): ShopifyClient {
  const maxRetries = opts.maxRetries ?? 5;
  const sleep = opts.sleep ?? defaultSleep;

  async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await graphql(query, variables ? { variables } : undefined);
      } catch (err) {
        // The library throws on non-2xx; it may carry a Response or a body.
        const r = extractResponse(err);
        if (r && attempt < maxRetries && (r.status === 429 || r.status >= 500)) {
          await sleep(backoff(attempt++, r.headers.get("retry-after")));
          continue;
        }
        const body = extractBody(err);
        if (body?.errors?.length) {
          const code = body.errors[0].extensions?.code;
          if (code === "THROTTLED" && attempt < maxRetries) {
            await sleep(throttleWait(body, attempt++));
            continue;
          }
          throw new ShopifyError(body.errors.map((e) => e.message).join("; "), code);
        }
        if (isNetworkError(err) && attempt < maxRetries) {
          await sleep(backoff(attempt++));
          continue;
        }
        throw err;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt++, res.headers.get("retry-after")));
          continue;
        }
        throw new ShopifyError(`HTTP ${res.status}`, String(res.status), true);
      }

      const body = (await res.json()) as GraphqlResponseBody<T>;
      if (body.errors?.length) {
        const code = body.errors[0].extensions?.code;
        if (code === "THROTTLED" && attempt < maxRetries) {
          await sleep(throttleWait(body, attempt++));
          continue;
        }
        throw new ShopifyError(
          body.errors.map((e) => e.message).join("; "),
          code,
          code === "THROTTLED",
        );
      }
      return body.data as T;
    }
  }

  return { shop, request };
}

function backoff(attempt: number, retryAfter?: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
}

function throttleWait(body: GraphqlResponseBody, attempt: number): number {
  const cost = body.extensions?.cost;
  const t = cost?.throttleStatus;
  if (t && cost?.requestedQueryCost && t.restoreRate > 0) {
    const missing = cost.requestedQueryCost - t.currentlyAvailable;
    if (missing > 0) return Math.ceil((missing / t.restoreRate) * 1000) + 100;
  }
  return backoff(attempt);
}

function extractResponse(err: unknown): Response | undefined {
  const e = err as { response?: unknown };
  if (typeof Response !== "undefined" && e?.response instanceof Response) return e.response;
  return undefined;
}

function extractBody(err: unknown): GraphqlResponseBody | undefined {
  const e = err as { body?: GraphqlResponseBody; response?: { errors?: unknown } };
  if (e?.body && typeof e.body === "object") return e.body;
  return undefined;
}

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code ?? "");
}

/** Plain fetch transport with an access token, e.g. for scripts. */
export function fetchGraphql(shop: string, accessToken: string, apiVersion: string): AdminGraphqlFn {
  return (query, options) =>
    fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": accessToken,
      },
      body: JSON.stringify({ query, variables: options?.variables }),
    });
}
