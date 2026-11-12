/**
 * ImportProvider (plan, C4; features 2-4). Social import runs on a paid fetch
 * provider behind this interface (decision 4); the provider, key and budget
 * are still to be chosen. Adapters are tried in order (primary, fallback).
 *
 * "fake" serves sample videos so the whole flow can be tested locally.
 */

export type Platform = "instagram" | "tiktok";

export interface SocialPost {
  platform: Platform;
  /** Platform's post id or shortcode, used to dedupe */
  externalId: string;
  url: string;
  caption: string;
  thumbnailUrl: string | null;
  postedAt: string | null;
  durationMs: number | null;
}

export interface DownloadedVideo {
  data: Blob;
  mimeType: string;
  filename: string;
}

export interface ImportProvider {
  name: string;
  /** Recent video posts of a public profile, newest first */
  listProfile(platform: Platform, username: string, limit?: number): Promise<SocialPost[]>;
  /** Post details from a pasted link */
  resolve(url: string): Promise<SocialPost>;
  download(post: SocialPost): Promise<DownloadedVideo>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** Retrying cannot help (private post, not a video, bad link) */
    public readonly permanent = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ParsedLink {
  platform: Platform;
  externalId: string | null;
  username: string | null;
}

/** Recognises Instagram and TikTok post links. Short links resolve later. */
export function parseSocialUrl(input: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "instagram.com" || host === "instagr.am") {
    const i = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p" || p === "tv");
    if (i >= 0 && parts[i + 1]) return { platform: "instagram", externalId: parts[i + 1], username: i > 0 ? parts[0] : null };
    return null;
  }
  if (host === "tiktok.com") {
    const i = parts.indexOf("video");
    if (i >= 0 && /^\d+$/.test(parts[i + 1] ?? "")) {
      return { platform: "tiktok", externalId: parts[i + 1], username: parts[0]?.replace(/^@/, "") ?? null };
    }
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return { platform: "tiktok", externalId: null, username: null };
  return null;
}

export function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").split(/[/?#]/)[0].toLowerCase().slice(0, 64);
}

/** Tries each provider in order; the first that answers wins. */
export class FallbackProvider implements ImportProvider {
  name: string;
  constructor(private readonly providers: ImportProvider[]) {
    if (!providers.length) throw new Error("No import provider configured");
    this.name = providers.map((p) => p.name).join("+");
  }

  private async tryAll<T>(fn: (p: ImportProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const p of this.providers) {
      try {
        return await fn(p);
      } catch (err) {
        last = err;
        // A permanent answer (private post) is the same from every provider.
        if (err instanceof ProviderError && err.permanent) throw err;
      }
    }
    throw last;
  }

  listProfile(platform: Platform, username: string, limit?: number) {
    return this.tryAll((p) => p.listProfile(platform, username, limit));
  }
  resolve(url: string) {
    return this.tryAll((p) => p.resolve(url));
  }
  download(post: SocialPost) {
    return this.tryAll((p) => p.download(post));
  }
}

/** Local stand-in: deterministic posts and a tiny valid MP4. */
export class FakeProvider implements ImportProvider {
  name = "fake";
  constructor(private readonly opts: { sampleVideoUrl?: string; posts?: number } = {}) {}

  private post(platform: Platform, username: string, i: number): SocialPost {
    const externalId = platform === "tiktok" ? String(7_300_000_000_000_000_000n + BigInt(i)) : `FAKE${username.toUpperCase()}${i}`;
    return {
      platform,
      externalId,
      url:
        platform === "tiktok"
          ? `https://www.tiktok.com/@${username}/video/${externalId}`
          : `https://www.instagram.com/reel/${externalId}/`,
      caption: `Sample post ${i + 1} from @${username} #ootd`,
      thumbnailUrl: null,
      postedAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
      durationMs: 15_000,
    };
  }

  async listProfile(platform: Platform, username: string, limit = 12) {
    const n = Math.min(this.opts.posts ?? 6, limit);
    return Array.from({ length: n }, (_, i) => this.post(platform, normalizeUsername(username), n - 1 - i));
  }

  async resolve(url: string) {
    const parsed = parseSocialUrl(url);
    if (!parsed) throw new ProviderError("That doesn't look like an Instagram or TikTok video link", true);
    const externalId = parsed.externalId ?? `short${url.length}`;
    return {
      platform: parsed.platform,
      externalId,
      url,
      caption: `Imported from ${parsed.platform}`,
      thumbnailUrl: null,
      postedAt: null,
      durationMs: 15_000,
    };
  }

  async download(post: SocialPost): Promise<DownloadedVideo> {
    if (this.opts.sampleVideoUrl) {
      const res = await fetch(this.opts.sampleVideoUrl);
      if (!res.ok) throw new ProviderError(`Sample video download failed (${res.status})`);
      return { data: await res.blob(), mimeType: "video/mp4", filename: `${post.externalId}.mp4` };
    }
    // ftyp box only: enough for the pipeline, Shopify would reject it.
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111, 109]);
    return { data: new Blob([bytes], { type: "video/mp4" }), mimeType: "video/mp4", filename: `${post.externalId}.mp4` };
  }
}

/**
 * Template for the paid provider once it's chosen. Most fetch APIs expose
 * "profile posts", "post by URL" and a direct video URL; map them here.
 */
export class HttpProvider implements ImportProvider {
  constructor(
    public readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" } });
    if (res.status === 404 || res.status === 403) throw new ProviderError("Post not found or private", true);
    if (!res.ok) throw new ProviderError(`${this.name} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async listProfile(platform: Platform, username: string, limit = 12) {
    const data = await this.get<{ posts: SocialPost[] }>(`/v1/${platform}/profile/posts`, {
      username: normalizeUsername(username),
      limit: String(limit),
      type: "video",
    });
    return data.posts;
  }

  async resolve(url: string) {
    const parsed = parseSocialUrl(url);
    if (!parsed) throw new ProviderError("That doesn't look like an Instagram or TikTok video link", true);
    return this.get<SocialPost>(`/v1/${parsed.platform}/post`, { url });
  }

  async download(post: SocialPost) {
    const meta = await this.get<{ videoUrl: string }>(`/v1/${post.platform}/post/media`, { url: post.url });
    const res = await fetch(meta.videoUrl);
    if (!res.ok) throw new ProviderError(`Video download failed (${res.status})`);
    return { data: await res.blob(), mimeType: res.headers.get("content-type") ?? "video/mp4", filename: `${post.externalId}.mp4` };
  }
}

export function providerFromEnv(env: Record<string, string | undefined> = process.env): ImportProvider {
  const build = (name: string | undefined): ImportProvider | null => {
    if (!name) return null;
    if (name === "fake") return new FakeProvider({ sampleVideoUrl: env.IMPORT_SAMPLE_VIDEO_URL });
    if (env.IMPORT_PROVIDER_BASE_URL && env.IMPORT_PROVIDER_API_KEY) {
      return new HttpProvider(name, env.IMPORT_PROVIDER_BASE_URL, env.IMPORT_PROVIDER_API_KEY);
    }
    return null;
  };
  const list = [build(env.IMPORT_PROVIDER ?? "fake"), build(env.IMPORT_PROVIDER_FALLBACK)].filter(
    (p): p is ImportProvider => Boolean(p),
  );
  return new FallbackProvider(list.length ? list : [new FakeProvider()]);
}
