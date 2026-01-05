import prisma from "../config/db";

export type ReportPeriod = "day" | "week" | "month" | "year";
export type ReportScope = "global" | "user";

export type GenerateReportInput = {
  ownerUserId: string;
  period: ReportPeriod;
  // YYYY-MM-DD (UTC). If omitted, uses "today" in UTC.
  anchorDate?: string;
  scope?: ReportScope;
  // Used when scope === "user". If omitted, defaults to ownerUserId.
  targetUserId?: string;
};

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAnchorDateUtc(anchorDate?: string): { date: Date; isoDate: string } {
  if (anchorDate !== undefined) {
    if (!isIsoDateOnly(anchorDate)) {
      const err = new Error("anchorDate must be YYYY-MM-DD");
      (err as unknown as { code?: string }).code = "INVALID_DATE";
      throw err;
    }
    const [y, m, d] = anchorDate.split("-").map((v) => Number(v));
    const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    // Guard against invalid dates like 2026-13-40
    if (Number.isNaN(date.getTime())) {
      const err = new Error("anchorDate is invalid");
      (err as unknown as { code?: string }).code = "INVALID_DATE";
      throw err;
    }
    return { date, isoDate: anchorDate };
  }

  const now = new Date();
  const isoDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return { date, isoDate };
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function computeReportRange(input: {
  period: ReportPeriod;
  anchorDate?: string;
}): {
  period: ReportPeriod;
  anchorDate: string;
  start: Date;
  end: Date;
  label: string;
} {
  const { date: anchor, isoDate } = parseAnchorDateUtc(input.anchorDate);

  if (input.period === "day") {
    const start = anchor;
    const end = addUtcDays(start, 1);
    return { period: "day", anchorDate: isoDate, start, end, label: isoDate };
  }

  if (input.period === "week") {
    // Week starts Monday (ISO-ish), in UTC.
    // JS getUTCDay: 0=Sun ... 6=Sat
    const day = anchor.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const start = addUtcDays(anchor, -daysSinceMonday);
    const end = addUtcDays(start, 7);
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(
      start.getUTCDate(),
    ).padStart(2, "0")}`;
    return { period: "week", anchorDate: isoDate, start, end, label };
  }

  if (input.period === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    return { period: "month", anchorDate: isoDate, start, end, label };
  }

  // year
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(anchor.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
  const label = `${start.getUTCFullYear()}`;
  return { period: "year", anchorDate: isoDate, start, end, label };
}

function decimalToString(value: unknown): string {
  // Prisma Decimal serializes to string in JSON already, but aggregate results can be Decimal objects.
  if (value === null || value === undefined) return "0";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString: () => string }).toString());
  }
  return String(value);
}

export async function generateActivityReport(input: GenerateReportInput) {
  const scope: ReportScope = input.scope ?? "global";
  const range = computeReportRange({ period: input.period, anchorDate: input.anchorDate });

  const targetUserId =
    scope === "user" ? (input.targetUserId ?? input.ownerUserId) : undefined;

  // Tables with direct userId fields.
  const whereUserId = targetUserId ? { userId: targetUserId } : undefined;

  // Tables without direct userId fields (need nested relation back to Image.userId).
  const whereViaImageUser = targetUserId
    ? { imageVersion: { image: { userId: targetUserId } } }
    : undefined;

  const whereImageVersionViaImageUser = targetUserId
    ? { image: { userId: targetUserId } }
    : undefined;

  const [
    newUsers,
    imagesCount,
    imagesAgg,
    imageVersionsCount,
    filtersAppliedCount,
    topFilterCounts,
    watermarksAppliedCount,
    topWatermarkPositions,
    watermarkPresetsCreated,
    subscriptionsCreated,
    subscriptionsActiveAtEnd,
    purchasesCount,
    purchasesAgg,
    paymentsCount,
    paymentsAgg,
    paymentByStatusCurrency,
    entitlementsCreated,
  ] = await Promise.all([
    scope === "global"
      ? prisma.userProfile.count({
          where: { createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),

    prisma.image.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.image.aggregate({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
      _sum: { sizeBytes: true },
    }),

    prisma.imageVersion.count({
      where: {
        ...(whereImageVersionViaImageUser ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.imageFilter.count({
      where: {
        ...(whereViaImageUser ?? {}),
        appliedAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.imageFilter.groupBy({
      by: ["filterId"],
      where: {
        ...(whereViaImageUser ?? {}),
        appliedAt: { gte: range.start, lt: range.end },
      },
      _count: { filterId: true },
      orderBy: { _count: { filterId: "desc" } },
      take: 10,
    }),

    prisma.imageVersionWatermark.count({
      where: {
        ...(whereViaImageUser ?? {}),
        appliedAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.imageVersionWatermark.groupBy({
      by: ["position"],
      where: {
        ...(whereViaImageUser ?? {}),
        appliedAt: { gte: range.start, lt: range.end },
      },
      _count: { position: true },
      orderBy: { _count: { position: "desc" } },
    }),

    prisma.watermark.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.subscription.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.subscription.count({
      where: {
        ...(whereUserId ?? {}),
        status: "active",
        currentPeriodStart: { lt: range.end },
        currentPeriodEnd: { gte: range.end },
      },
    }),

    prisma.purchase.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.purchase.aggregate({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
      _sum: { totalAmount: true, quantity: true },
    }),

    prisma.payment.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

    prisma.payment.aggregate({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
      _sum: { amount: true },
    }),

    prisma.payment.groupBy({
      by: ["status", "currency"],
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: [{ status: "asc" }, { currency: "asc" }],
    }),

    prisma.entitlement.count({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { gte: range.start, lt: range.end },
      },
    }),
  ]);

  const filterIds = topFilterCounts.map((r) => r.filterId);
  const filters = filterIds.length
    ? await prisma.filter.findMany({ where: { id: { in: filterIds } } })
    : [];
  const filterNameById = new Map(filters.map((f) => [f.id, f.name] as const));

  const topFilters = topFilterCounts.map((r) => ({
    filterId: r.filterId,
    filterName: filterNameById.get(r.filterId) ?? null,
    count: r._count.filterId,
  }));

  const watermarkPositions = topWatermarkPositions.map((r) => ({
    position: r.position,
    count: r._count.position,
  }));

  const reportData = {
    scope,
    targetUserId: targetUserId ?? null,
    range: {
      period: range.period,
      anchorDate: range.anchorDate,
      label: range.label,
      start: range.start,
      end: range.end,
    },
    metrics: {
      users: {
        newUsersCount: newUsers,
      },
      images: {
        uploadedCount: imagesCount,
        uploadedTotalSizeBytes: (imagesAgg._sum.sizeBytes ?? BigInt(0)).toString(),
        editedVersionsCreatedCount: imageVersionsCount,
      },
      filters: {
        appliedCount: filtersAppliedCount,
        topFilters,
      },
      watermarks: {
        presetsCreatedCount: watermarkPresetsCreated,
        appliedCount: watermarksAppliedCount,
        positions: watermarkPositions,
      },
      subscriptions: {
        createdCount: subscriptionsCreated,
        activeAtPeriodEndCount: subscriptionsActiveAtEnd,
      },
      purchases: {
        count: purchasesCount,
        quantitySum: purchasesAgg._sum.quantity ?? 0,
        totalAmountSum: decimalToString(purchasesAgg._sum.totalAmount),
      },
      payments: {
        count: paymentsCount,
        amountSum: decimalToString(paymentsAgg._sum.amount),
        byStatusAndCurrency: paymentByStatusCurrency.map((r) => ({
          status: r.status,
          currency: r.currency,
          count: r._count._all,
          amountSum: decimalToString(r._sum.amount),
        })),
      },
      entitlements: {
        createdCount: entitlementsCreated,
      },
    },
  };

  const created = await prisma.report.create({
    data: {
      userId: input.ownerUserId,
      type: scope === "global" ? "global_activity" : "user_activity",
      data: reportData,
    },
  });

  return created;
}

export async function listReports(input: {
  userId: string;
  type?: string;
  limit?: number;
}) {
  const take =
    typeof input.limit === "number" && Number.isInteger(input.limit)
      ? Math.max(1, Math.min(100, input.limit))
      : 20;

  return prisma.report.findMany({
    where: {
      userId: input.userId,
      ...(input.type ? { type: input.type } : {}),
    },
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
    take,
  });
}
