import fs from "node:fs";
import path from "node:path";

export const uploadsDir = path.join(process.cwd(), "uploads");

export function ensureUploadsDir(): void {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}
