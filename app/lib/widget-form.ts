/**
 * Turns the widget editor's FormData into settings and rules. Runs in the
 * browser (live preview) and on the server (save), so both agree.
 * Field names are dotted paths ("style.cardRadius"); checkboxes are listed in
 * the hidden "__bools" field so unchecked ones read as false.
 */
import { normalizeRules, normalizeWidgetSettings, type WidgetType } from "@sv/shared";

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    cur[k] = (cur[k] as Record<string, unknown>) ?? {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

export function parseWidgetForm(form: FormData) {
  const settings: Record<string, unknown> = {};
  const bools = String(form.get("__bools") ?? "").split(",").filter(Boolean);
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("s.")) continue;
    const raw = String(v);
    setPath(settings, k.slice(2), /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw);
  }
  for (const b of bools) {
    if (!b.startsWith("s.")) continue;
    setPath(settings, b.slice(2), form.getAll(b).some((v) => v === "on" || v === "true"));
  }
  const type = String(form.get("type") ?? "carousel") as WidgetType;
  const list = (name: string) =>
    String(form.get(name) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const rules = normalizeRules({
    pageTypes: form.getAll("r.pageTypes").map(String),
    includeProducts: list("r.includeProducts"),
    excludeProducts: list("r.excludeProducts"),
    includeCollections: list("r.includeCollections"),
    excludeCollections: list("r.excludeCollections"),
  });
  return {
    name: String(form.get("name") ?? ""),
    type,
    settings: normalizeWidgetSettings(settings, type),
    rules,
    assignedCollections: list("assignedCollections"),
    videoIds: list("videoIds"),
  };
}
