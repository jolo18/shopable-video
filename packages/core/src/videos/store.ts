/**
 * VideoStore (plan, C4). v1: ShopifyFilesStore, videos live in the merchant's
 * own Shopify Files (decision 1). Later: an external CDN for stores past
 * Shopify's caps, behind the same interface.
 */
import { assertNoUserErrors, type ShopifyClient } from "../shopify/client";

export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface UploadFile {
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadTarget {
  /** Where the browser (or worker) POSTs the file */
  url: string;
  /** Hand back to finalize() */
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

export type FileStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

export interface VideoSource {
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface StoredFile {
  id: string;
  status: FileStatus;
  error?: string;
  /** Video only */
  durationMs?: number;
  posterUrl?: string;
  sources?: VideoSource[];
  /** Image only */
  imageUrl?: string;
  width?: number;
  height?: number;
}

export interface VideoStore {
  createUpload(file: UploadFile, kind?: "video" | "image"): Promise<UploadTarget>;
  createUploads(files: UploadFile[], kind?: "video" | "image"): Promise<UploadTarget[]>;
  finalize(resourceUrl: string, opts?: { kind?: "video" | "image"; alt?: string }): Promise<StoredFile>;
  get(fileId: string): Promise<StoredFile | null>;
  remove(fileIds: string[]): Promise<string[]>;
}

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

export function checkUpload(file: UploadFile, kind: "video" | "image" = "video"): void {
  const types = kind === "video" ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!types.includes(file.mimeType)) {
    throw new UploadRejected(
      kind === "video"
        ? `${file.filename}: use MP4, MOV or WebM`
        : `${file.filename}: use JPG, PNG, WebP or GIF`,
    );
  }
  if (!(file.size > 0) || file.size > max) {
    throw new UploadRejected(
      `${file.filename}: files must be under ${kind === "video" ? "1 GB" : "20 MB"}`,
    );
  }
}

const STAGED_UPLOADS = `#graphql
  mutation svStagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const FILE_CREATE = `#graphql
  mutation svFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }`;

const FILE_GET = `#graphql
  query svFile($id: ID!) {
    node(id: $id) {
      ... on Video {
        id
        fileStatus
        fileErrors { message }
        duration
        preview { image { url width height } }
        sources { url mimeType width height }
      }
      ... on MediaImage {
        id
        fileStatus
        fileErrors { message }
        image { url width height }
      }
    }
  }`;

const FILE_DELETE = `#graphql
  mutation svFileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message code }
    }
  }`;

export class ShopifyFilesStore implements VideoStore {
  constructor(private readonly client: ShopifyClient) {}

  async createUpload(file: UploadFile, kind: "video" | "image" = "video") {
    const [t] = await this.createUploads([file], kind);
    return t;
  }

  async createUploads(files: UploadFile[], kind: "video" | "image" = "video") {
    files.forEach((f) => checkUpload(f, kind));
    const data = await this.client.request(STAGED_UPLOADS, {
      input: files.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        fileSize: String(f.size),
        resource: kind === "video" ? "VIDEO" : "IMAGE",
        httpMethod: "POST",
      })),
    });
    assertNoUserErrors("stagedUploadsCreate", data.stagedUploadsCreate);
    return data.stagedUploadsCreate.stagedTargets as UploadTarget[];
  }

  async finalize(resourceUrl: string, opts: { kind?: "video" | "image"; alt?: string } = {}) {
    const data = await this.client.request(FILE_CREATE, {
      files: [
        {
          originalSource: resourceUrl,
          contentType: opts.kind === "image" ? "IMAGE" : "VIDEO",
          alt: (opts.alt ?? "").slice(0, 512),
        },
      ],
    });
    assertNoUserErrors("fileCreate", data.fileCreate);
    const f = data.fileCreate.files[0];
    return { id: f.id, status: f.fileStatus as FileStatus };
  }

  async get(fileId: string): Promise<StoredFile | null> {
    const data = await this.client.request(FILE_GET, { id: fileId });
    const n = data.node;
    if (!n) return null;
    const error = n.fileErrors?.map((e: { message: string }) => e.message).join("; ") || undefined;
    if (n.image !== undefined) {
      return {
        id: n.id,
        status: n.fileStatus,
        error,
        imageUrl: n.image?.url,
        width: n.image?.width,
        height: n.image?.height,
      };
    }
    const sources: VideoSource[] = (n.sources ?? []).map(
      (s: VideoSource) => ({ url: s.url, mimeType: s.mimeType, width: s.width, height: s.height }),
    );
    const largest = [...sources].sort((a, b) => b.width - a.width)[0];
    return {
      id: n.id,
      status: n.fileStatus,
      error,
      durationMs: n.duration ?? undefined,
      posterUrl: n.preview?.image?.url,
      sources,
      width: largest?.width ?? n.preview?.image?.width,
      height: largest?.height ?? n.preview?.image?.height,
    };
  }

  async remove(fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const data = await this.client.request(FILE_DELETE, { fileIds });
    // A file the merchant already deleted in Shopify is not an error for us.
    const errs = data.fileDelete.userErrors ?? [];
    const real = errs.filter((e: { code?: string }) => e.code !== "FILE_DOES_NOT_EXIST");
    assertNoUserErrors("fileDelete", { userErrors: real });
    return data.fileDelete.deletedFileIds ?? [];
  }
}
