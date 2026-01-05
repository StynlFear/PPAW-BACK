import type { Request, Response } from "express";

import {
  getUserCurrentMonthUsage,
  getUserProfileById,
  getUserUploadLimits,
} from "../models/uploadModel";
import { isUuid } from "../utils/validators";

export async function getUserQuotaHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const [limits, usage] = await Promise.all([
      getUserUploadLimits(userId),
      getUserCurrentMonthUsage(userId),
    ]);

    if (!limits) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }

    const maxImages = limits.maxImagesPerMonth;
    const maxStorageMb = limits.maxStorageMbPerMonth;

    const usedImages = usage.imageCount;
    const usedStorageBytes = usage.storageBytes;

    const maxStorageBytes =
      typeof maxStorageMb === "number" && Number.isFinite(maxStorageMb)
        ? BigInt(Math.floor(maxStorageMb)) * BigInt(1024) * BigInt(1024)
        : null;

    const remainingImages =
      typeof maxImages === "number" && Number.isFinite(maxImages)
        ? Math.max(0, Math.floor(maxImages) - usedImages)
        : null;

    const remainingStorageBytes =
      maxStorageBytes === null
        ? null
        : maxStorageBytes > usedStorageBytes
          ? maxStorageBytes - usedStorageBytes
          : BigInt(0);

    return res.json({
      plan: {
        id: limits.planId,
        name: limits.planName,
      },
      window: {
        from: usage.monthStart,
        to: usage.nextMonthStart,
      },
      limits: {
        maxImagesPerMonth: maxImages,
        maxStorageMbPerMonth: maxStorageMb,
        maxStorageBytesPerMonth: maxStorageBytes,
      },
      usage: {
        imagesThisMonth: usedImages,
        storageBytesThisMonth: usedStorageBytes,
      },
      remaining: {
        imagesThisMonth: remainingImages,
        storageBytesThisMonth: remainingStorageBytes,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
