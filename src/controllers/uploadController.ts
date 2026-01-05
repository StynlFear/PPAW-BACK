import type { Request, Response } from "express";
import crypto from "node:crypto";
import path from "node:path";

import multer from "multer";

import {
  getPublicUrlForObject,
  tryDeleteStorageObject,
  uploadBufferToStorage,
} from "../config/supabase";
import {
  createImageForUpload,
  deleteImageVersionForImage,
  getUserCurrentMonthUsage,
  getUserProfileById,
  getUserUploadLimits,
  listImageVersionsForUser,
  listImagesForUser,
} from "../models/uploadModel";
import { isUuid } from "../utils/validators";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

export const uploadSingleFile = upload.single("file");

// Upload photo
// Expects multipart/form-data: file=<binary>, userId=<uuid>
export async function uploadImageHandler(req: Request, res: Response) {
  let uploadedObjectPath: string | undefined;
  const bucket = "ppaw";

  try {
    const userId = req.body?.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId (uuid) is required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    // Enforce plan limits (monthly quotas).
    const [limits, usage] = await Promise.all([
      getUserUploadLimits(userId),
      getUserCurrentMonthUsage(userId),
    ]);

    if (!limits) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }

    const uploadSizeBytes = BigInt(req.file.size);

    if (
      typeof limits.maxImagesPerMonth === "number" &&
      Number.isFinite(limits.maxImagesPerMonth) &&
      usage.imageCount + 1 > Math.floor(limits.maxImagesPerMonth)
    ) {
      return res.status(403).json({
        error: `monthly upload limit reached for plan ${limits.planName}`,
      });
    }

    if (
      typeof limits.maxStorageMbPerMonth === "number" &&
      Number.isFinite(limits.maxStorageMbPerMonth)
    ) {
      const limitBytes = BigInt(Math.floor(limits.maxStorageMbPerMonth)) *
        BigInt(1024) *
        BigInt(1024);

      if (usage.storageBytes + uploadSizeBytes > limitBytes) {
        return res.status(403).json({
          error: `monthly storage limit reached for plan ${limits.planName}`,
        });
      }
    }

    const safeExt = path.extname(req.file.originalname).slice(0, 16);
    uploadedObjectPath = `images/${userId}/${crypto.randomUUID()}${safeExt}`;

    await uploadBufferToStorage({
      bucket,
      objectPath: uploadedObjectPath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });

    const originalUrl = getPublicUrlForObject({
      bucket,
      objectPath: uploadedObjectPath,
    });

    const image = await createImageForUpload({
      userId,
      originalUrl,
      sizeBytes: BigInt(req.file.size),
    });

    return res.status(201).json({
      ...image,
      sizeBytes: image.sizeBytes === null ? null : image.sizeBytes?.toString(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    await tryDeleteStorageObject({ bucket, objectPath: uploadedObjectPath });
    return res.status(500).json({ error: "internal error" });
  }
}

// List all images for a user
// GET /images/:userId
export async function listUserImagesHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const images = await listImagesForUser(userId);
    return res.json(
      images.map((img) => ({
        ...img,
        sizeBytes: img.sizeBytes === null ? null : img.sizeBytes?.toString(),
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// List all image versions created for a user
// GET /images/:userId/versions
export async function listUserImageVersionsHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const versions = await listImageVersionsForUser(userId);
    return res.json(versions);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

function extractSupabasePublicObjectPath(inputUrl: string, bucket: string): string | null {
  try {
    const u = new URL(inputUrl);
    const prefix = `/storage/v1/object/public/${bucket}/`;
    if (!u.pathname.startsWith(prefix)) return null;
    const objectPathEncoded = u.pathname.slice(prefix.length);
    if (!objectPathEncoded) return null;
    return decodeURIComponent(objectPathEncoded);
  } catch {
    return null;
  }
}

// Delete an image version by imageId + versionId
// DELETE /images/:imageId/versions/:versionId
export async function deleteImageVersionHandler(req: Request, res: Response) {
  const bucket = "ppaw";

  try {
    const imageId = req.params.imageId;
    const versionId = req.params.versionId;

    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }
    if (!isUuid(versionId)) {
      return res.status(400).json({ error: "versionId must be a uuid" });
    }

    const deleted = await deleteImageVersionForImage({ imageId, versionId });
    if (!deleted) {
      return res.status(404).json({ error: "image version not found" });
    }

    // Best-effort: only delete storage object if it looks like a Supabase public URL
    // and differs from the original upload object's path.
    const editedObjectPath = extractSupabasePublicObjectPath(deleted.editedUrl, bucket);
    const originalObjectPath = extractSupabasePublicObjectPath(deleted.originalUrl, bucket);
    if (editedObjectPath && editedObjectPath !== originalObjectPath) {
      await tryDeleteStorageObject({ bucket, objectPath: editedObjectPath });
    }

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
