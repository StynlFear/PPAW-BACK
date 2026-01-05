import prisma from "../config/db";

export type UserPlanFeatures = {
  watermark: boolean | null;
  aiEnhancement: boolean | null;
};

type FeaturesJson = {
  watermark?: unknown;
  ai_enhancement?: unknown;
};

function toOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function parseFeaturesJson(value: unknown): UserPlanFeatures {
  if (!value || typeof value !== "object") {
    return { watermark: null, aiEnhancement: null };
  }

  const features = value as FeaturesJson;
  return {
    watermark: toOptionalBoolean(features.watermark),
    aiEnhancement: toOptionalBoolean(features.ai_enhancement),
  };
}

export async function getUserPlanFeatures(userId: string) {
  const active = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { plan: true },
  });

  const plan = active?.plan;
  if (!plan) {
    return { ok: false as const, reason: "NO_ACTIVE_SUBSCRIPTION" as const };
  }

  return {
    ok: true as const,
    plan: { id: plan.id, name: plan.name },
    features: parseFeaturesJson(plan.featuresJson),
  };
}
