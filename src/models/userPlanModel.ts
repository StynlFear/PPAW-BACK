import prisma from "../config/db";

export async function getUserActivePlan(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { plan: true },
  });
}
