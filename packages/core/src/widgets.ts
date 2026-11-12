/**
 * Widget service (plan, C3): layouts, video order, styles, show rules,
 * drafts. Edits stay as a draft (dirty) until publish.
 */
import type { Prisma } from "@prisma/client";
import {
  MAX_VIDEOS_PER_WIDGET,
  defaultSettingsFor,
  isWidgetType,
  normalizeRules,
  normalizeWidgetSettings,
  type WidgetType,
} from "@sv/shared";
import { prisma, type Db } from "./db";

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "widget"
  );
}

async function uniqueHandle(shopId: string, name: string, db: Db) {
  const base = slug(name);
  for (let i = 0; i < 100; i++) {
    const handle = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.widget.findUnique({ where: { shopId_handle: { shopId, handle } } });
    if (!taken) return handle;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createWidget(
  shopId: string,
  input: { name: string; type: string },
  db: Db = prisma,
) {
  if (!isWidgetType(input.type)) throw new Error("Unknown widget type");
  const name = input.name.trim().slice(0, 80) || "Untitled widget";
  return db.widget.create({
    data: {
      shopId,
      name,
      type: input.type,
      handle: await uniqueHandle(shopId, name, db),
      settings: defaultSettingsFor(input.type) as unknown as Prisma.InputJsonValue,
      rules: {},
    },
  });
}

export async function listWidgets(shopId: string, db: Db = prisma) {
  return db.widget.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { videos: true } } },
  });
}

export async function getWidget(shopId: string, id: string, db: Db = prisma) {
  return db.widget.findFirst({
    where: { id, shopId },
    include: { videos: { orderBy: { position: "asc" }, include: { video: true } } },
  });
}

export interface WidgetUpdate {
  name?: string;
  type?: WidgetType;
  settings?: unknown;
  rules?: unknown;
  /** Collection gids this widget shows on (collection metafield) */
  assignedCollections?: string[];
}

export async function updateWidget(shopId: string, id: string, input: WidgetUpdate, db: Db = prisma) {
  const w = await db.widget.findFirst({ where: { id, shopId } });
  if (!w) throw new Error("Widget not found");
  const type = input.type && isWidgetType(input.type) ? input.type : (w.type as WidgetType);
  const data: Prisma.WidgetUpdateInput = { dirty: true, type };
  if (typeof input.name === "string") data.name = input.name.trim().slice(0, 80) || w.name;
  if (input.settings !== undefined) {
    data.settings = normalizeWidgetSettings(input.settings, type) as unknown as Prisma.InputJsonValue;
  }
  if (input.rules !== undefined || input.assignedCollections !== undefined) {
    const prev = (w.rules ?? {}) as Record<string, unknown>;
    const rules = input.rules !== undefined ? normalizeRules(input.rules) : normalizeRules(prev);
    const assigned =
      input.assignedCollections !== undefined
        ? [...new Set(input.assignedCollections.filter((c) => /^gid:\/\/shopify\/Collection\/\d+$/.test(c)))]
        : ((prev.assignedCollections as string[] | undefined) ?? []);
    data.rules = { ...rules, assignedCollections: assigned } as unknown as Prisma.InputJsonValue;
  }
  return db.widget.update({ where: { id }, data });
}

/** Picks and orders the widget's videos (feature 56). */
export async function setWidgetVideos(shopId: string, id: string, videoIds: string[], db: Db = prisma) {
  const w = await db.widget.findFirst({ where: { id, shopId } });
  if (!w) throw new Error("Widget not found");
  const unique = [...new Set(videoIds)];
  if (unique.length > MAX_VIDEOS_PER_WIDGET) {
    throw new Error(`A widget holds at most ${MAX_VIDEOS_PER_WIDGET} videos.`);
  }
  const owned = await db.video.findMany({
    where: { shopId, id: { in: unique } },
    select: { id: true },
  });
  const ok = new Set(owned.map((v) => v.id));
  const ordered = unique.filter((v) => ok.has(v));
  await db.$transaction([
    db.widgetVideo.deleteMany({ where: { widgetId: id } }),
    db.widgetVideo.createMany({ data: ordered.map((videoId, position) => ({ widgetId: id, videoId, position })) }),
    db.widget.update({ where: { id }, data: { dirty: true } }),
  ]);
  return ordered;
}

/** Adds videos to the end of a widget (library bulk action). */
export async function addVideosToWidget(shopId: string, id: string, videoIds: string[], db: Db = prisma) {
  const w = await getWidget(shopId, id, db);
  if (!w) throw new Error("Widget not found");
  const current = w.videos.map((v) => v.videoId);
  return setWidgetVideos(shopId, id, [...current, ...videoIds.filter((v) => !current.includes(v))], db);
}

export async function deleteWidget(shopId: string, id: string, db: Db = prisma) {
  const w = await db.widget.findFirst({ where: { id, shopId } });
  if (!w) return null;
  await db.widget.delete({ where: { id } });
  return w;
}

/** Published widgets that include any of these videos. */
export async function publishedWidgetsWith(shopId: string, videoIds: string[], db: Db = prisma) {
  return db.widget.findMany({
    where: { shopId, status: "published", videos: { some: { videoId: { in: videoIds } } } },
    select: { id: true },
  });
}
