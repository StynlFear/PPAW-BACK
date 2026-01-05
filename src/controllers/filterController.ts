import type { Request, Response } from "express";

import {
  applyFilterToImage,
  applyFiltersToImage,
  canUserUseFilter,
  deleteLatestFilterFromImage,
  getFilterById,
  getImageById,
  getLatestFiltersForImage,
  listFilterHistoryForImage,
  listAllowedFiltersForUser,
  listFilters,
} from "../models/filterModel";
import { getUserProfileById } from "../models/uploadModel";
import { isIntegerBetween, isUuid } from "../utils/validators";

type FilterStackItem = { filterId: number; intensity?: number };

function normalizeFilterStack(value: unknown): FilterStackItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: FilterStackItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const filterId = (item as { filterId?: unknown }).filterId;
    const intensity = (item as { intensity?: unknown }).intensity;
    if (typeof filterId !== "number" || !Number.isInteger(filterId)) return null;
    if (intensity !== undefined && (typeof intensity !== "number" || !Number.isInteger(intensity))) {
      return null;
    }
    items.push({ filterId, intensity: intensity as number | undefined });
  }
  return items;
}

function normalizeFilterIds(value: unknown): number[] | null {
  if (typeof value === "number" && Number.isInteger(value)) return [value];
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) return null;
    out.push(item);
  }
  return out;
}

function normalizeIntensities(value: unknown, count: number): number[] | null {
  if (value === undefined) return Array.from({ length: count }, () => 100);
  if (typeof value === "number" && Number.isInteger(value)) {
    return Array.from({ length: count }, () => value);
  }
  if (Array.isArray(value)) {
    if (value.length !== count) return null;
    const out: number[] = [];
    for (const item of value) {
      if (typeof item !== "number" || !Number.isInteger(item)) return null;
      out.push(item);
    }
    return out;
  }
  return null;
}

// List filters
export async function listFiltersHandler(_req: Request, res: Response) {
  try {
    const filters = await listFilters();
    return res.json(filters);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// List filters allowed for a specific user based on their active subscription plan
// GET /filters/:userId
export async function listUserAllowedFiltersHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) return res.status(404).json({ error: "user not found" });

    const result = await listAllowedFiltersForUser(userId);
    if (!result.ok && result.reason === "NO_ACTIVE_SUBSCRIPTION") {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }

    return res.json(result.filters);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Apply filter to a photo by imageId + filterId
// Creates an ImageVersion + ImageFilter (since schema links filters to versions)
// Expects JSON body:
// - Single: { "filterId": number, "intensity"?: number }
// - Multiple: { "filters": [{ "filterId": number, "intensity"?: number }, ...] }
export async function applyFilterHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    // New preferred shape:
    // - Single: { "filterId": 1, "intensity"?: 0..100 }
    // - Multiple: { "filterId": [1,2], "intensity"?: 0..100 | [..] }
    const normalizedFilterIds = normalizeFilterIds(req.body?.filterId);
    const normalizedIntensities = normalizeIntensities(
      req.body?.intensity,
      normalizedFilterIds?.length ?? 0,
    );

    let stack: { filterId: number; intensity: number }[];
    if (normalizedFilterIds && normalizedIntensities) {
      stack = normalizedFilterIds.map((filterId, idx) => ({
        filterId,
        intensity: normalizedIntensities[idx] ?? 100,
      }));
    } else {
      // Legacy support (backwards compatible): { "filters": [{filterId,intensity?}, ...] }
      const parsed = normalizeFilterStack(req.body?.filters);
      if (!parsed || parsed.length === 0) {
        return res.status(400).json({
          error: "filterId (integer or integer[]) is required",
        });
      }

      stack = parsed.map((f) => ({
        filterId: f.filterId,
        intensity: f.intensity === undefined ? 100 : f.intensity,
      }));
    }

    // Validate intensities and ensure unique filterIds.
    const seen = new Set<number>();
    for (const item of stack) {
      if (!isIntegerBetween(item.intensity, 0, 100)) {
        return res.status(400).json({
          error: "intensity must be an integer between 0 and 100",
        });
      }
      if (seen.has(item.filterId)) {
        return res.status(400).json({ error: "filters must be unique by filterId" });
      }
      seen.add(item.filterId);
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    // Ensure all filters exist and are allowed.
    const filterIds = stack.map((s) => s.filterId);
    const [filters, allowedChecks] = await Promise.all([
      Promise.all(filterIds.map((id) => getFilterById(id))),
      Promise.all(filterIds.map((id) => canUserUseFilter({ userId: image.userId, filterId: id }))),
    ]);

    const missingIdx = filters.findIndex((f) => !f);
    if (missingIdx !== -1) return res.status(404).json({ error: "filter not found" });

    if (allowedChecks.some((a) => !a.ok && a.reason === "NO_ACTIVE_SUBSCRIPTION")) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }
    if (allowedChecks.some((a) => !a.ok && a.reason === "FILTER_NOT_ALLOWED")) {
      return res.status(403).json({
        error: "filter not allowed for user's subscription plan",
      });
    }

    const created = await applyFiltersToImage({
      imageId: image.id,
      filters: stack,
      // No actual image processing in this minimal backend: keep URL same.
      editedUrl: image.originalUrl,
      metadata: {
        filterIds,
        filters: stack.map((s, sortOrder) => ({
          filterId: s.filterId,
          intensity: s.intensity,
          sortOrder,
        })),
      },
    });

    // Backwards compat: keep "link" for single-filter clients.
    return res.status(201).json({
      ...created,
      link: created.links[0] ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// GET /images/:imageId/filters (latest applied)
export async function getLatestAppliedFiltersHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const rows = await getLatestFiltersForImage({ imageId });
    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// GET /images/:imageId/filters/history
// Returns image versions where metadata includes the full filter stack snapshot.
export async function getFilterHistoryHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const image = await getImageById(imageId);
    if (!image) return res.status(404).json({ error: "image not found" });

    const history = await listFilterHistoryForImage({ imageId });
    return res.json(history);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Delete (remove) the latest application of a filter on an image.
// Deletes only the ImageFilter link (ImageVersion history is retained for rollback).
export async function deleteAppliedFilterHandler(req: Request, res: Response) {
  try {
    const imageId = req.params.imageId;
    if (!isUuid(imageId)) {
      return res.status(400).json({ error: "imageId must be a uuid" });
    }

    const filterIdRaw = req.params.filterId;
    const filterId = Number(filterIdRaw);
    if (!Number.isInteger(filterId)) {
      return res.status(400).json({ error: "filterId (integer) is required" });
    }

    const deleted = await deleteLatestFilterFromImage({ imageId, filterId });
    if (!deleted) {
      return res.status(404).json({ error: "applied filter not found" });
    }

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
