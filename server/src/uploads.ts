import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.CLEW_UPLOADS || path.join(__dirname, "..", "data", "uploads");

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const EXTENSION: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const isSupportedImage = (mediaType: string): mediaType is ImageMediaType =>
  mediaType in EXTENSION;

export function saveUpload(mediaType: ImageMediaType, bytes: Buffer): string {
  fs.mkdirSync(DIR, { recursive: true });
  const name = `${randomUUID()}.${EXTENSION[mediaType]}`;
  fs.writeFileSync(path.join(DIR, name), bytes);
  return `/uploads/${name}`;
}

// URLやパスからではなくファイル名だけを見て解決し、DIRの外に出られないようにする
function resolve(url: string): { file: string; mediaType: ImageMediaType } | null {
  const name = path.basename(url);
  const extension = path.extname(name).slice(1).toLowerCase();
  const types = Object.keys(EXTENSION) as ImageMediaType[];
  const mediaType = types.find((type) => EXTENSION[type] === extension);
  if (!mediaType) return null;
  return { file: path.join(DIR, name), mediaType };
}

export function readUpload(url: string): { mediaType: ImageMediaType; bytes: Buffer } | null {
  const found = resolve(url);
  if (!found || !fs.existsSync(found.file)) return null;
  return { mediaType: found.mediaType, bytes: fs.readFileSync(found.file) };
}

export function deleteUploads(urls: string[]) {
  for (const url of urls) {
    const found = resolve(url);
    if (found) fs.rmSync(found.file, { force: true });
  }
}
