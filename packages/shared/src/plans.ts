/**
 * Plans and entitlements (plan decision 5): a free plan plus paid tiers gated
 * on video count and features, unlimited views on every plan.
 * Entitlements are derived from the plan and read on both sides: the admin
 * enforces them, the storefront reads the published flags (branding badge).
 */

export interface Entitlements {
  /** null = no app limit (Shopify's per-store video cap still applies) */
  maxVideos: number | null;
  /** More than one product tagged on a video */
  multiTag: boolean;
  /** Show the "Powered by" badge on widgets */
  branding: boolean;
  analytics: boolean;
  autoSync: boolean;
}

export type PlanKey = "free" | "starter" | "growth" | "pro";

export interface Plan {
  key: PlanKey;
  /** Name shown in the admin and used as the Shopify billing plan name */
  name: string;
  /** USD per month */
  price: number;
  trialDays: number;
  entitlements: Entitlements;
}

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    price: 0,
    trialDays: 0,
    entitlements: {
      maxVideos: 15,
      multiTag: false,
      branding: true,
      analytics: false,
      autoSync: false,
    },
  },
  starter: {
    key: "starter",
    name: "Starter",
    price: 9.99,
    trialDays: 14,
    entitlements: {
      maxVideos: 100,
      multiTag: true,
      branding: false,
      analytics: true,
      autoSync: false,
    },
  },
  growth: {
    key: "growth",
    name: "Growth",
    price: 24.99,
    trialDays: 14,
    entitlements: {
      maxVideos: 500,
      multiTag: true,
      branding: false,
      analytics: true,
      autoSync: true,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    price: 49.99,
    trialDays: 14,
    entitlements: {
      maxVideos: null,
      multiTag: true,
      branding: false,
      analytics: true,
      autoSync: true,
    },
  },
};

export const PAID_PLAN_KEYS: PlanKey[] = ["starter", "growth", "pro"];

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

export function planFor(key: string | null | undefined): Plan {
  return isPlanKey(key) ? PLANS[key] : PLANS.free;
}

export function entitlementsFor(key: string | null | undefined): Entitlements {
  return planFor(key).entitlements;
}

/** Plan whose billing name matches, for Shopify subscription lookups. */
export function planByName(name: string): Plan | undefined {
  return Object.values(PLANS).find((p) => p.name === name);
}

/** How many more videos the shop may add under its plan. */
export function videosRemaining(
  ent: Entitlements,
  currentCount: number,
): number {
  if (ent.maxVideos === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, ent.maxVideos - currentCount);
}
