import prisma from "../config/db";
import type { Prisma } from "@prisma/client";

export type FilterStackItemInput = {
  filterId: number;
  intensity: number;
};

export async function canUserUseFilter(input: { userId: string; filterId: number }) {
  const active = await prisma.subscription.findFirst({
    where: { userId: input.userId, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { planId: true },
  });

  if (!active) {
    return { ok: false as const, reason: "NO_ACTIVE_SUBSCRIPTION" as const };
  }

  const link = await prisma.subscriptionPlanFilter.findUnique({
    where: {
      planId_filterId: {
        planId: active.planId,
        filterId: input.filterId,
      },
    },
    select: { planId: true },
  });

  if (!link) {
    return { ok: false as const, reason: "FILTER_NOT_ALLOWED" as const };
  }

  return { ok: true as const };
}

export async function listFilters() {
  return prisma.filter.findMany({ orderBy: { id: "asc" } });
}

export async function listAllowedFiltersForUser(userId: string) {
  const active = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { planId: true },
  });

  if (!active) {
    return { ok: false as const, reason: "NO_ACTIVE_SUBSCRIPTION" as const };
  }

  const rows = await prisma.subscriptionPlanFilter.findMany({
    where: { planId: active.planId },
    orderBy: [{ filterId: "asc" }],
    include: { filter: true },
  });

  return { ok: true as const, filters: rows.map((r) => r.filter) };
}

export async function getImageById(id: string) {
  return prisma.image.findUnique({ where: { id } });
}

export async function getFilterById(id: number) {
  return prisma.filter.findUnique({ where: { id } });
}

export async function applyFilterToImage(input: {
  imageId: string;
  filterId: number;
  intensity: number;
  editedUrl: string;
  metadata: Prisma.InputJsonValue;
}) {
  // Backwards-compatible wrapper for single-filter apply.
  return applyFiltersToImage({
    imageId: input.imageId,
    editedUrl: input.editedUrl,
    filters: [{ filterId: input.filterId, intensity: input.intensity }],
    metadata: input.metadata,
  });
}

export async function applyFiltersToImage(input: {
  imageId: string;
  filters: FilterStackItemInput[];
  editedUrl: string;
  metadata: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.imageVersion.create({
      data: {
        imageId: input.imageId,
        editedUrl: input.editedUrl,
        metadata: input.metadata,
      },
    });

    if (input.filters.length > 0) {
      await tx.imageFilter.createMany({
        data: input.filters.map((f, idx) => ({
          imageVersionId: version.id,
          filterId: f.filterId,
          intensity: f.intensity,
          sortOrder: idx,
        })),
      });
    }

    // Keep only the latest applied filter links for this image.
    // ImageVersion history is retained (metadata carries the filter stack snapshot).
    await tx.imageFilter.deleteMany({
      where: {
        imageVersionId: { not: version.id },
        imageVersion: {
          imageId: input.imageId,
        },
      },
    });

    const links = await tx.imageFilter.findMany({
      where: { imageVersionId: version.id },
      orderBy: [{ appliedAt: "asc" }, { filterId: "asc" }],
      include: { filter: true },
    });

    return { version, links };
  });
}

export async function getLatestFiltersForImage(input: { imageId: string }) {
  const latestVersion = await prisma.imageVersion.findFirst({
    where: { imageId: input.imageId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  if (!latestVersion) return [];

  return prisma.imageFilter.findMany({
    where: { imageVersionId: latestVersion.id },
    orderBy: [{ appliedAt: "asc" }, { filterId: "asc" }],
    include: { filter: true },
  });
}

export async function listFilterHistoryForImage(input: { imageId: string }) {
  return prisma.imageVersion.findMany({
    where: { imageId: input.imageId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      imageId: true,
      editedUrl: true,
      metadata: true,
      createdAt: true,
    },
  });
}

export async function deleteLatestFilterFromImage(input: {
  imageId: string;
  filterId: number;
}) {
  return prisma.$transaction(async (tx) => {
    const latestVersion = await tx.imageVersion.findFirst({
      where: { imageId: input.imageId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, metadata: true },
    });

    if (!latestVersion) return null;

    const latest = await tx.imageFilter.findUnique({
      where: {
        imageVersionId_filterId: {
          imageVersionId: latestVersion.id,
          filterId: input.filterId,
        },
      },
      select: { imageVersionId: true, filterId: true },
    });

    if (!latest) return null;

    await tx.imageFilter.delete({
      where: {
        imageVersionId_filterId: {
          imageVersionId: latest.imageVersionId,
          filterId: latest.filterId,
        },
      },
    });

    // Best-effort: keep latest version metadata consistent if it contains a filter stack.
    const md = latestVersion.metadata;
    if (md && typeof md === "object" && "filters" in (md as Record<string, unknown>)) {
      const filters = (md as { filters?: unknown }).filters;
      if (Array.isArray(filters)) {
        const nextFilters = filters.filter((f) => {
          if (!f || typeof f !== "object") return true;
          const id = (f as { filterId?: unknown }).filterId;
          return id !== input.filterId;
        });
        await tx.imageVersion.update({
          where: { id: latestVersion.id },
          data: {
            metadata: {
              ...(md as Record<string, unknown>),
              filters: nextFilters,
              filterIds: nextFilters
                .map((f) => (f && typeof f === "object" ? (f as { filterId?: unknown }).filterId : undefined))
                .filter((v): v is number => typeof v === "number"),
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    return latest;
  });
}
