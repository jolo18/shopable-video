import { prisma } from "@sv/core";

const TABLES = [
  "events",
  "stats_daily",
  "attributed_orders",
  "jobs",
  "import_jobs",
  "social_accounts",
  "widget_videos",
  "widgets",
  "video_products",
  "videos",
  "shops",
  '"Session"',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function makeShop(domain = "test-shop.myshopify.com", plan = "free") {
  return prisma.shop.create({ data: { domain, plan } });
}

export { prisma };
