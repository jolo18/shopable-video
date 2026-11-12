/**
 * Browser side of the upload flow: ask the app for staged targets, POST each
 * file straight to Shopify's storage, then ask the app to create the file.
 * Runs a few uploads at a time and reports progress per file.
 */
export interface UploadProgress {
  filename: string;
  /** 0..1 */
  progress: number;
  state: "waiting" | "uploading" | "finalizing" | "done" | "error";
  error?: string;
}

interface Target {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

async function post(action: string, body: unknown) {
  const res = await fetch(action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function putToTarget(target: Target, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", target.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

export async function uploadVideos(
  action: string,
  files: File[],
  onUpdate: (all: UploadProgress[]) => void,
  concurrency = 3,
) {
  const state: UploadProgress[] = files.map((f) => ({ filename: f.name, progress: 0, state: "waiting" }));
  const emit = () => onUpdate(state.map((s) => ({ ...s })));
  emit();

  const { uploads } = (await post(action, {
    intent: "start_uploads",
    files: files.map((f) => ({ filename: f.name, mimeType: f.type || guessType(f.name), size: f.size })),
  })) as { uploads: Array<{ videoId: string; target: Target }> };

  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const { videoId, target } = uploads[i];
      try {
        state[i].state = "uploading";
        emit();
        await putToTarget(target, files[i], (p) => {
          state[i].progress = p;
          emit();
        });
        state[i].state = "finalizing";
        emit();
        await post(action, { intent: "finalize", videoId, resourceUrl: target.resourceUrl });
        state[i].state = "done";
        state[i].progress = 1;
      } catch (err) {
        state[i].state = "error";
        state[i].error = (err as Error).message;
        await post(action, { intent: "abandon", videoId, reason: state[i].error }).catch(() => {});
      }
      emit();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return state;
}

export function guessType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "mp4" ? "video/mp4" : "";
}
