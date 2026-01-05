import type { Prisma } from "@prisma/client";

import prisma from "../config/db";

function addPeriod(input: Date, period: string): Date {
  const d = new Date(input.getTime());
  switch (period) {
    case "daily":
      d.setDate(d.getDate() + 1);
      return d;
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "yearly":
    case "annual":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + 1);
      return d;
  }
}

export async function setUserActivePlan(input: { userId: string; planId: number }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [user, plan] = await Promise.all([
      tx.userProfile.findUnique({ where: { id: input.userId }, select: { id: true } }),
      tx.subscriptionPlan.findUnique({ where: { id: input.planId } }),
    ]);

    if (!user) return { ok: false as const, reason: "USER_NOT_FOUND" as const };
    if (!plan) return { ok: false as const, reason: "PLAN_NOT_FOUND" as const };

    const now = new Date();

    await tx.subscription.updateMany({
      where: { userId: input.userId, status: "active" },
      data: { status: "cancelled", currentPeriodEnd: now },
    });

    const created = await tx.subscription.create({
      data: {
        userId: input.userId,
        planId: input.planId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: addPeriod(now, plan.period),
      },
    });

    return { ok: true as const, subscription: created };
  });
}
