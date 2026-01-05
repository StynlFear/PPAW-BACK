import prisma from "../config/db";
import type { Prisma } from "@prisma/client";

type WatermarkPlacementRow = {
  watermarkId: number | null;
  text: string;
  position: string;
  opacity: number;
  font: string;
  sortOrder: number;
  id: number;
};

export async function listWatermarkPresets(input?: { userId?: string }) {
  return prisma.watermark.findMany({
    where: input?.userId ? { userId: input.userId } : undefined,
    orderBy: { id: "asc" },
  });
}

export async function getWatermarkPresetById(id: number) {
  return prisma.watermark.findUnique({ where: { id } });
}

export async function createWatermarkPreset(input: {
  userId: string;
  presetName: string;
  text: string;
  position: string;
  opacity: number;
  font: string;
}) {
  return prisma.watermark.create({
    data: {
      userId: input.userId,
      presetName: input.presetName,
      text: input.text,
      position: input.position,
      opacity: input.opacity,
      font: input.font,
    },
  });
}

export async function applyWatermarkToImage(input: {
  imageId: string;
  watermarkId: number;
  editedUrl: string;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const watermark = await tx.watermark.findUnique({
      where: { id: input.watermarkId },
    });
    if (!watermark) {
      const err = new Error("watermark not found");
      (err as unknown as { code?: string }).code = "NOT_FOUND";
      throw err;
    }
    if (!watermark.text || watermark.text.trim().length === 0) {
      const err = new Error("watermark text is empty");
      (err as unknown as { code?: string }).code = "INVALID_WATERMARK";
      throw err;
    }

    const latestVersion = await tx.imageVersion.findFirst({
      where: { imageId: input.imageId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const previous: WatermarkPlacementRow[] = latestVersion
      ? ((await tx.imageVersionWatermark.findMany({
          where: { imageVersionId: latestVersion.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        })) as unknown as WatermarkPlacementRow[])
      : [];

    const version = await tx.imageVersion.create({
      data: {
        imageId: input.imageId,
        editedUrl: input.editedUrl,
        metadata: {
          watermarkId: input.watermarkId,
          watermarkIds: [
            ...previous
              .map((p) => p.watermarkId)
              .filter((v): v is number => v !== null),
            input.watermarkId,
          ],
        },
      },
    });

    // Carry forward previously-applied watermarks into the new version.
    if (previous.length > 0) {
      await tx.imageVersionWatermark.createMany({
        data: previous.map((p) => ({
          imageVersionId: version.id,
          watermarkId: p.watermarkId,
          text: p.text,
          position: p.position,
          opacity: p.opacity,
          font: p.font,
          sortOrder: p.sortOrder,
        })),
      });
    }

    const maxSort = previous.reduce<number>(
      (acc, p) => Math.max(acc, typeof p.sortOrder === "number" ? p.sortOrder : 0),
      -1,
    );

    const createdPlacement = await tx.imageVersionWatermark.create({
      data: {
        imageVersionId: version.id,
        watermarkId: watermark.id,
        text: watermark.text,
        position: watermark.position,
        opacity: watermark.opacity,
        font: watermark.font ?? "Inter",
        sortOrder: maxSort + 1,
      },
    });

    // Keep only the latest watermark placements for this image.
    await tx.imageVersionWatermark.deleteMany({
      where: {
        imageVersionId: { not: version.id },
        imageVersion: { imageId: input.imageId },
      },
    });

    return { version, placement: createdPlacement };
  });
}

export async function getLatestWatermarksForImage(input: { imageId: string }) {
  const latestVersion = await prisma.imageVersion.findFirst({
    where: { imageId: input.imageId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!latestVersion) return [];

  return prisma.imageVersionWatermark.findMany({
    where: { imageVersionId: latestVersion.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function deleteLatestWatermarkFromImage(input: {
  imageId: string;
  watermarkId: number;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const latest = await tx.imageVersionWatermark.findFirst({
      where: {
        watermarkId: input.watermarkId,
        imageVersion: { imageId: input.imageId },
      },
      orderBy: { appliedAt: "desc" },
      select: { id: true },
    });

    if (!latest) return null;

    await tx.imageVersionWatermark.delete({ where: { id: latest.id } });

    return latest;
  });
}

export async function listWatermarkHistoryForImage(input: { imageId: string }) {
  return prisma.imageVersion.findMany({
    where: { imageId: input.imageId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageId: true,
      editedUrl: true,
      metadata: true,
      createdAt: true,
    },
  });
}
