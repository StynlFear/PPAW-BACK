import prisma from "../config/db";

export async function listSubscriptionPlans() {
  return prisma.subscriptionPlan.findMany({ orderBy: { id: "asc" } });
}

export async function getSubscriptionPlanById(id: number) {
  return prisma.subscriptionPlan.findUnique({ where: { id } });
}

export async function listFiltersForPlan(planId: number) {
  const rows = await prisma.subscriptionPlanFilter.findMany({
    where: { planId },
    orderBy: [{ filterId: "asc" }],
    include: { filter: true },
  });

  return rows.map((r) => r.filter);
}

export async function replacePlanFilters(input: {
  planId: number;
  filterIds: number[];
}) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.subscriptionPlan.findUnique({
      where: { id: input.planId },
      select: { id: true },
    });
    if (!plan) return { ok: false as const, reason: "PLAN_NOT_FOUND" as const };

    if (input.filterIds.length > 0) {
      const existing = await tx.filter.findMany({
        where: { id: { in: input.filterIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((f) => f.id));
      const missing = input.filterIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        return {
          ok: false as const,
          reason: "FILTER_NOT_FOUND" as const,
          missing,
        };
      }
    }

    await tx.subscriptionPlanFilter.deleteMany({ where: { planId: input.planId } });

    if (input.filterIds.length > 0) {
      await tx.subscriptionPlanFilter.createMany({
        data: input.filterIds.map((filterId) => ({
          planId: input.planId,
          filterId,
        })),
        skipDuplicates: true,
      });
    }

    return { ok: true as const };
  });
}
