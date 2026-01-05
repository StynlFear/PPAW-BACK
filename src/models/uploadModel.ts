import prisma from "../config/db";

export type UserUploadLimits = {
  planId: number;
  planName: string;
  maxImagesPerMonth: number | null;
  maxStorageMbPerMonth: number | null;
};

type LimitsJson = {
  max_storage_mb?: unknown;
  max_images_month?: unknown;
};

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseLimitsJson(value: unknown): { maxStorageMbPerMonth: number | null; maxImagesPerMonth: number | null } {
  if (!value || typeof value !== "object") {
    return { maxStorageMbPerMonth: null, maxImagesPerMonth: null };
  }

  const limits = value as LimitsJson;
  return {
    maxStorageMbPerMonth: toOptionalNumber(limits.max_storage_mb),
    maxImagesPerMonth: toOptionalNumber(limits.max_images_month),
  };
}

export async function getUserProfileById(id: string) {
  return prisma.userProfile.findUnique({ where: { id } });
}

export async function getUserUploadLimits(userId: string): Promise<UserUploadLimits | null> {
  const active = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { plan: true },
  });

  const plan = active?.plan;
  if (!plan) return null;

  const parsed = parseLimitsJson(plan.limitsJson);
  return {
    planId: plan.id,
    planName: plan.name,
    maxImagesPerMonth: parsed.maxImagesPerMonth,
    maxStorageMbPerMonth: parsed.maxStorageMbPerMonth,
  };
}

export async function getUserCurrentMonthUsage(userId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  const [count, aggregate] = await Promise.all([
    prisma.image.count({
      where: { userId, createdAt: { gte: monthStart, lt: nextMonthStart } },
    }),
    prisma.image.aggregate({
      where: { userId, createdAt: { gte: monthStart, lt: nextMonthStart } },
      _sum: { sizeBytes: true },
    }),
  ]);

  return {
    monthStart,
    nextMonthStart,
    imageCount: count,
    storageBytes: aggregate._sum.sizeBytes ?? BigInt(0),
  };
}

export async function createImageForUpload(input: {
  userId: string;
  originalUrl: string;
  sizeBytes: bigint;
}) {
  return prisma.image.create({
    data: {
      userId: input.userId,
      originalUrl: input.originalUrl,
      sizeBytes: input.sizeBytes,
    },
  });
}
