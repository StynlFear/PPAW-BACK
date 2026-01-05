import crypto from "node:crypto";

import prisma from "../config/db";

export type CreateUserProfileInput = {
  id?: string;
  email: string;
  role?: "user" | "admin";
  name: string | null;
  avatarUrl: string | null;
};

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

export async function createUserProfile(input: CreateUserProfileInput) {
  const data = {
    ...(input.id ? { id: input.id } : {}),
    email: input.email,
    role: input.role ?? "user",
    name: input.name,
    avatarUrl: input.avatarUrl,
  };

  try {
    return await prisma.$transaction(async (tx: { userProfile: { create: (arg0: { data: { email: string; role: "user" | "admin"; name: string | null; avatarUrl: string | null; id?: string | undefined; }; }) => any; }; subscriptionPlan: { findUnique: (arg0: { where: { id: number; } | { name: string; }; }) => any; }; subscription: { create: (arg0: { data: { userId: any; planId: any; status: string; currentPeriodStart: Date; currentPeriodEnd: Date; }; }) => any; }; }) => {
      const createdUser = await tx.userProfile.create({ data });

      // Assign Free plan by default.
      // Prefer id=1, then fall back to a plan named "Free".
      const plan =
        (await tx.subscriptionPlan.findUnique({ where: { id: 1 } })) ??
        (await tx.subscriptionPlan.findUnique({ where: { name: "Free" } }));

      if (!plan) {
        throw new Error(
          "Default subscription plan not found (expected id=1 or name=Free)",
        );
      }

      const start = new Date();
      const end = addPeriod(start, plan.period);

      await tx.subscription.create({
        data: {
          userId: createdUser.id,
          planId: plan.id,
          status: "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });

      return createdUser;
    });
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;

    // If the DB column has NOT NULL but no default yet, create again with an explicit UUID.
    if (code === "P2011" && !input.id) {
      return await prisma.$transaction(async (tx: { userProfile: { create: (arg0: { data: { id: `${string}-${string}-${string}-${string}-${string}`; email: string; role: "user" | "admin"; name: string | null; avatarUrl: string | null; }; }) => any; }; subscriptionPlan: { findUnique: (arg0: { where: { id: number; } | { name: string; }; }) => any; }; subscription: { create: (arg0: { data: { userId: any; planId: any; status: string; currentPeriodStart: Date; currentPeriodEnd: Date; }; }) => any; }; }) => {
        const createdUser = await tx.userProfile.create({
          data: { ...data, id: crypto.randomUUID() },
        });

        const plan =
          (await tx.subscriptionPlan.findUnique({ where: { id: 1 } })) ??
          (await tx.subscriptionPlan.findUnique({ where: { name: "Free" } }));
        if (!plan) {
          throw new Error(
            "Default subscription plan not found (expected id=1 or name=Free)",
          );
        }

        const start = new Date();
        const end = addPeriod(start, plan.period);

        await tx.subscription.create({
          data: {
            userId: createdUser.id,
            planId: plan.id,
            status: "active",
            currentPeriodStart: start,
            currentPeriodEnd: end,
          },
        });

        return createdUser;
      });
    }

    throw err;
  }
}
