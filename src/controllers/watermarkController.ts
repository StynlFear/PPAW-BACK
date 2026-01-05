import type { Request, Response } from "express";

import {
  applyWatermarkToImage,
  createWatermarkPreset,
  getLatestWatermarksForImage,
  getWatermarkPresetById,
  listWatermarkPresets,
  deleteLatestWatermarkFromImage,
  listWatermarkHistoryForImage,
} from "../models/watermarkModel";
import { getImageById } from "../models/filterModel";
import { getUserPlanFeatures } from "../models/featureAccessModel";
import { getUserProfileById } from "../models/uploadModel";
import { isIntegerBetween, isUuid } from "../utils/validators";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// List watermark presets (optionally filtered by userId)
// GET /watermarks?userId=<uuid>
export async function listWatermarksHandler(req: Request, res: Response) {
  try {
    const userId = req.query.userId;
    if (userId !== undefined && !isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    // If requesting presets for a specific user, enforce that the plan enables watermark feature.
    if (typeof userId === "string") {
      const access = await getUserPlanFeatures(userId);
      if (!access.ok) {
        return res.status(409).json({ error: "user has no active subscription plan" });
      }
      if (access.features.watermark !== true) {
        return res
          .status(403)
          .json({ error: "watermarks not allowed for user's subscription plan" });
      }
    }

    const watermarks = await listWatermarkPresets({
      ...(userId ? { userId } : {}),
    });

    return res.json(watermarks);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Create a watermark preset
// POST /watermarks
// Body: { userId: uuid, presetName: string, text?: string, position?: string, opacity?: number, font?: string }
export async function createWatermarkHandler(req: Request, res: Response) {
  try {
    const userId = req.body?.userId;
    const presetName = req.body?.presetName;
    const text = req.body?.text;
    const position = req.body?.position;
    const opacity = req.body?.opacity;
    const font = req.body?.font;

    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId (uuid) is required" });
    }
    if (!isNonEmptyString(presetName)) {
      return res.status(400).json({ error: "presetName is required" });
    }
    if (!isNonEmptyString(text)) {
      return res.status(400).json({ error: "text is required" });
    }
    if (position !== undefined && typeof position !== "string") {
      return res.status(400).json({ error: "position must be a string" });
    }

    const normalizedOpacity = opacity === undefined ? 60 : opacity;
    if (!isIntegerBetween(normalizedOpacity, 0, 100)) {
      return res
        .status(400)
        .json({ error: "opacity must be an integer between 0 and 100" });
    }

    const normalizedFont = typeof font === "string" && font.trim() ? font : "Inter";
    const normalizedPosition = typeof position === "string" && position.trim()
      ? position
      : "bottom-right";

    const user = await getUserProfileById(userId);
    if (!user) return res.status(404).json({ error: "user not found" });

    const access = await getUserPlanFeatures(userId);
    if (!access.ok) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (access.features.watermark !== true) {
      return res
        .status(403)
        .json({ error: "watermarks not allowed for user's subscription plan" });
    }

    const created = await createWatermarkPreset({
      userId,
      presetName: presetName.trim(),
      text: text.trim(),
      position: normalizedPosition,
      opacity: normalizedOpacity,
      font: normalizedFont,
    });

    return res.status(201).json(created);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Apply a watermark to an image.
// Creates a new ImageVersion and stores a snapshot of watermark metadata.
// POST /images/:imageId/watermarks
// Body: { watermarkId: number }
export async function applyWatermarksHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const watermarkId = req.body?.watermarkId;
    if (typeof watermarkId !== "number" || !Number.isInteger(watermarkId)) {
      return res.status(400).json({ error: "watermarkId (integer) is required" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const access = await getUserPlanFeatures(image.userId);
    if (!access.ok) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (access.features.watermark !== true) {
      return res
        .status(403)
        .json({ error: "watermarks not allowed for user's subscription plan" });
    }

    // Ensure watermark exists early (clear 404 instead of 500).
    const preset = await getWatermarkPresetById(watermarkId);
    if (!preset) return res.status(404).json({ error: "watermark not found" });

    const created = await applyWatermarkToImage({
      imageId: image.id,
      watermarkId,
      editedUrl: image.originalUrl,
    });

    return res.status(201).json(created);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "NOT_FOUND"
    ) {
      return res.status(404).json({ error: "watermark not found" });
    }
    return res.status(500).json({ error: "internal error" });
  }
}

// GET /images/:imageId/watermarks (latest applied)
export async function getLatestWatermarksHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const access = await getUserPlanFeatures(image.userId);
    if (!access.ok) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (access.features.watermark !== true) {
      return res
        .status(403)
        .json({ error: "watermarks not allowed for user's subscription plan" });
    }

    const placements = await getLatestWatermarksForImage({ imageId });
    return res.json(placements);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// GET /images/:imageId/watermarks/history
export async function getWatermarkHistoryHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const access = await getUserPlanFeatures(image.userId);
    if (!access.ok) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (access.features.watermark !== true) {
      return res
        .status(403)
        .json({ error: "watermarks not allowed for user's subscription plan" });
    }

    const history = await listWatermarkHistoryForImage({ imageId });
    return res.json(history);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// DELETE /images/:imageId/watermarks/:watermarkId (latest applied)
export async function deleteLatestWatermarksHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const watermarkIdRaw = req.params.watermarkId;
    const watermarkId = Number(watermarkIdRaw);
    if (!Number.isInteger(watermarkId)) {
      return res.status(400).json({ error: "watermarkId (integer) is required" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const access = await getUserPlanFeatures(image.userId);
    if (!access.ok) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (access.features.watermark !== true) {
      return res
        .status(403)
        .json({ error: "watermarks not allowed for user's subscription plan" });
    }

    const deleted = await deleteLatestWatermarkFromImage({ imageId, watermarkId });
    if (!deleted) return res.status(404).json({ error: "applied watermark not found" });

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
