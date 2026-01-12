import { Prisma } from "@prisma/client";

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

function formatUtcYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function formatUtcYmdHour(date: Date): string {
  return `${formatUtcYmd(date)}T${String(date.getUTCHours()).padStart(2, "0")}:00Z`;
}

function formatBucketLabel(unit: "hour" | "day" | "month", date: Date): string {
  if (unit === "hour") return formatUtcYmdHour(date);
  if (unit === "day") return formatUtcYmd(date);
  // month
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), date.getUTCHours()));
}

function addBucket(date: Date, unit: "hour" | "day" | "month", step: number): Date {
  if (unit === "hour") return new Date(date.getTime() + step * 60 * 60 * 1000);
  if (unit === "day") return addUtcDays(date, step);
  return addUtcMonths(date, step);
}

function getTrendConfig(period: ReportPeriod): {
  unit: "hour" | "day" | "month";
  interval: string;
} {
  if (period === "day") return { unit: "hour", interval: "1 hour" };
  if (period === "year") return { unit: "month", interval: "1 month" };
  // week | month
  return { unit: "day", interval: "1 day" };
}

export async function generateActivityReport(input: GenerateReportInput) {
  const scope: ReportScope = input.scope ?? "global";
  const range = computeReportRange({ period: input.period, anchorDate: input.anchorDate });

  const trendCfg = getTrendConfig(range.period);

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
    totalUsersCount,
    newUsers,
    activeSubscriptionsAtEnd,
    freeSubscriptionsAtEnd,
    paidSubscriptionsAtEnd,
    paidUsersAtPeriodEnd,
    payingUsersInPeriod,
    imagesCount,
    imagesAgg,
    totalStorageAgg,
    imageVersionsCount,
    filtersAppliedCount,
    topFilterCounts,
    watermarksAppliedCount,
    topWatermarkPositions,
    watermarkPresetsCreated,
    subscriptionsCreated,
    purchasesCount,
    purchasesAgg,
    paidPurchasesAgg,
    paidPurchasesToDateAgg,
    paymentsCount,
    paymentsAgg,
    paymentByStatusCurrency,
    entitlementsCreated,
    trendRows,
    filterTrendRows,
  ] = await Promise.all([
    scope === "global"
      ? prisma.userProfile.count()
      : Promise.resolve(0),

    scope === "global"
      ? prisma.userProfile.count({
          where: { createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),

    scope === "global"
      ? prisma.subscription.count({
          where: {
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
          },
        })
      : prisma.subscription.count({
          where: {
            ...(whereUserId ?? {}),
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
          },
        }),

    scope === "global"
      ? prisma.subscription.count({
          where: {
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
            plan: { price: { equals: 0 } },
          },
        })
      : prisma.subscription.count({
          where: {
            ...(whereUserId ?? {}),
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
            plan: { price: { equals: 0 } },
          },
        }),

    scope === "global"
      ? prisma.subscription.count({
          where: {
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
            plan: { price: { gt: 0 } },
          },
        })
      : prisma.subscription.count({
          where: {
            ...(whereUserId ?? {}),
            status: "active",
            currentPeriodStart: { lt: range.end },
            currentPeriodEnd: { gte: range.end },
            plan: { price: { gt: 0 } },
          },
        }),

    prisma.subscription.groupBy({
      by: ["userId"],
      where: {
        ...(whereUserId ?? {}),
        status: "active",
        currentPeriodStart: { lt: range.end },
        currentPeriodEnd: { gte: range.end },
        plan: { price: { gt: 0 } },
      },
    }),

    prisma.purchase.groupBy({
      by: ["userId"],
      where: {
        ...(whereUserId ?? {}),
        status: "paid",
        createdAt: { gte: range.start, lt: range.end },
      },
    }),

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

    prisma.image.aggregate({
      where: {
        ...(whereUserId ?? {}),
        createdAt: { lt: range.end },
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

    prisma.purchase.aggregate({
      where: {
        ...(whereUserId ?? {}),
        status: "paid",
        createdAt: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
    }),

    prisma.purchase.aggregate({
      where: {
        ...(whereUserId ?? {}),
        status: "paid",
        createdAt: { lt: range.end },
      },
      _sum: { totalAmount: true },
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

    prisma.$queryRaw<
      Array<{
        bucket_start: Date;
        new_users_count: bigint;
        images_uploaded_count: bigint;
        images_uploaded_bytes: bigint;
        image_versions_created_count: bigint;
        filters_applied_count: bigint;
        watermarks_applied_count: bigint;
        purchases_paid_count: bigint;
        purchases_paid_amount_sum: unknown;
        payments_count: bigint;
        payments_amount_sum: unknown;
      }>
    >(Prisma.sql`
      WITH buckets AS (
        SELECT generate_series(
          ${range.start}::timestamptz,
          (${range.end}::timestamptz - ${trendCfg.interval}::interval),
          ${trendCfg.interval}::interval
        ) AS bucket_start
      ),
      new_users AS (
        SELECT date_trunc(${trendCfg.unit}, up.created_at) AS bucket_start,
               COUNT(*)::bigint AS new_users_count
        FROM user_profiles up
        WHERE up.created_at >= ${range.start}::timestamptz
          AND up.created_at < ${range.end}::timestamptz
        GROUP BY 1
      ),
      images AS (
        SELECT date_trunc(${trendCfg.unit}, i.created_at) AS bucket_start,
               COUNT(*)::bigint AS images_uploaded_count,
               COALESCE(SUM(i.size_bytes), 0)::bigint AS images_uploaded_bytes
        FROM images i
        WHERE i.created_at >= ${range.start}::timestamptz
          AND i.created_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND i.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      ),
      versions AS (
        SELECT date_trunc(${trendCfg.unit}, iv.created_at) AS bucket_start,
               COUNT(*)::bigint AS image_versions_created_count
        FROM image_versions iv
        JOIN images i ON i.id = iv.image_id
        WHERE iv.created_at >= ${range.start}::timestamptz
          AND iv.created_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND i.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      ),
      filters AS (
        SELECT date_trunc(${trendCfg.unit}, f.applied_at) AS bucket_start,
               COUNT(*)::bigint AS filters_applied_count
        FROM image_filters f
        JOIN image_versions iv ON iv.id = f.image_version_id
        JOIN images i ON i.id = iv.image_id
        WHERE f.applied_at >= ${range.start}::timestamptz
          AND f.applied_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND i.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      ),
      watermarks AS (
        SELECT date_trunc(${trendCfg.unit}, w.applied_at) AS bucket_start,
               COUNT(*)::bigint AS watermarks_applied_count
        FROM image_version_watermarks w
        JOIN image_versions iv ON iv.id = w.image_version_id
        JOIN images i ON i.id = iv.image_id
        WHERE w.applied_at >= ${range.start}::timestamptz
          AND w.applied_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND i.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      ),
      purchases AS (
        SELECT date_trunc(${trendCfg.unit}, p.created_at) AS bucket_start,
               COUNT(*)::bigint AS purchases_paid_count,
               COALESCE(SUM(p.total_amount), 0) AS purchases_paid_amount_sum
        FROM purchases p
        WHERE p.status = 'paid'
          AND p.created_at >= ${range.start}::timestamptz
          AND p.created_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND p.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      ),
      payments AS (
        SELECT date_trunc(${trendCfg.unit}, pm.created_at) AS bucket_start,
               COUNT(*)::bigint AS payments_count,
               COALESCE(SUM(pm.amount), 0) AS payments_amount_sum
        FROM payments pm
        WHERE pm.created_at >= ${range.start}::timestamptz
          AND pm.created_at < ${range.end}::timestamptz
          ${targetUserId ? Prisma.sql`AND pm.user_id = ${targetUserId}::uuid` : Prisma.empty}
        GROUP BY 1
      )
      SELECT
        b.bucket_start,
        ${scope === "global" ? Prisma.sql`COALESCE(nu.new_users_count, 0)` : Prisma.sql`0`} AS new_users_count,
        COALESCE(img.images_uploaded_count, 0) AS images_uploaded_count,
        COALESCE(img.images_uploaded_bytes, 0) AS images_uploaded_bytes,
        COALESCE(v.image_versions_created_count, 0) AS image_versions_created_count,
        COALESCE(fl.filters_applied_count, 0) AS filters_applied_count,
        COALESCE(wm.watermarks_applied_count, 0) AS watermarks_applied_count,
        COALESCE(pc.purchases_paid_count, 0) AS purchases_paid_count,
        COALESCE(pc.purchases_paid_amount_sum, 0) AS purchases_paid_amount_sum,
        COALESCE(pm.payments_count, 0) AS payments_count,
        COALESCE(pm.payments_amount_sum, 0) AS payments_amount_sum
      FROM buckets b
      LEFT JOIN images img USING (bucket_start)
      LEFT JOIN versions v USING (bucket_start)
      LEFT JOIN filters fl USING (bucket_start)
      LEFT JOIN watermarks wm USING (bucket_start)
      LEFT JOIN purchases pc USING (bucket_start)
      LEFT JOIN payments pm USING (bucket_start)
      ${scope === "global" ? Prisma.sql`LEFT JOIN new_users nu USING (bucket_start)` : Prisma.empty}
      ORDER BY b.bucket_start ASC;
    `),

    prisma.$queryRaw<
      Array<{
        bucket_start: Date;
        filter_id: number;
        applied_count: bigint;
      }>
    >(Prisma.sql`
      WITH buckets AS (
        SELECT generate_series(
          ${range.start}::timestamptz,
          (${range.end}::timestamptz - ${trendCfg.interval}::interval),
          ${trendCfg.interval}::interval
        ) AS bucket_start
      )
      SELECT
        date_trunc(${trendCfg.unit}, f.applied_at) AS bucket_start,
        f.filter_id,
        COUNT(*)::bigint AS applied_count
      FROM image_filters f
      JOIN image_versions iv ON iv.id = f.image_version_id
      JOIN images i ON i.id = iv.image_id
      WHERE f.applied_at >= ${range.start}::timestamptz
        AND f.applied_at < ${range.end}::timestamptz
        ${targetUserId ? Prisma.sql`AND i.user_id = ${targetUserId}::uuid` : Prisma.empty}
      GROUP BY 1, 2
      ORDER BY 1 ASC;
    `),
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

  const topFilterIdSet = new Set(topFilters.map((t) => t.filterId));
  const filterTrendCountByBucketKeyAndFilterId = new Map<string, bigint>();
  for (const row of filterTrendRows) {
    if (!topFilterIdSet.has(row.filter_id)) continue;
    const bucketKey = new Date(row.bucket_start).toISOString();
    filterTrendCountByBucketKeyAndFilterId.set(`${bucketKey}|${row.filter_id}`, row.applied_count);
  }

  const trends = {
    unit: trendCfg.unit,
    buckets: trendRows.map((r) => {
      const bucketStart = new Date(r.bucket_start);
      const bucketEnd = addBucket(bucketStart, trendCfg.unit, 1);
      return {
        bucketStart: bucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        label: formatBucketLabel(trendCfg.unit, bucketStart),
        metrics: {
          usersNewCount: Number(r.new_users_count ?? 0n),
          imagesUploadedCount: Number(r.images_uploaded_count ?? 0n),
          imagesUploadedBytes: (r.images_uploaded_bytes ?? 0n).toString(),
          imageVersionsCreatedCount: Number(r.image_versions_created_count ?? 0n),
          filtersAppliedCount: Number(r.filters_applied_count ?? 0n),
          watermarksAppliedCount: Number(r.watermarks_applied_count ?? 0n),
          purchasesPaidCount: Number(r.purchases_paid_count ?? 0n),
          purchasesPaidAmountSum: decimalToString(r.purchases_paid_amount_sum),
          paymentsCount: Number(r.payments_count ?? 0n),
          paymentsAmountSum: decimalToString(r.payments_amount_sum),
        },
      };
    }),
    filters: {
      topFilters,
      series: topFilters.map((f) => ({
        filterId: f.filterId,
        filterName: f.filterName,
        points: trendRows.map((r) => {
          const bucketStart = new Date(r.bucket_start);
          const bucketKey = bucketStart.toISOString();
          const count = filterTrendCountByBucketKeyAndFilterId.get(`${bucketKey}|${f.filterId}`) ?? 0n;
          return {
            bucketStart: bucketKey,
            label: formatBucketLabel(trendCfg.unit, bucketStart),
            count: Number(count),
          };
        }),
      })),
    },
  };

  const watermarkPositions = topWatermarkPositions.map((r) => ({
    position: r.position,
    count: r._count.position,
  }));

  const paidPurchasesAmountInPeriod = new Prisma.Decimal(
    decimalToString(paidPurchasesAgg._sum.totalAmount),
  );
  const paidPurchasesAmountToDate = new Prisma.Decimal(
    decimalToString(paidPurchasesToDateAgg._sum.totalAmount),
  );

  const payingUsersInPeriodCount = payingUsersInPeriod.length;
  const averageSpendPerPayingUserInPeriod = payingUsersInPeriodCount
    ? paidPurchasesAmountInPeriod.div(payingUsersInPeriodCount).toString()
    : "0";

  const averageSpendPerUserInPeriod =
    scope === "global" && totalUsersCount > 0
      ? paidPurchasesAmountInPeriod.div(totalUsersCount).toString()
      : null;

  // Business rule:
  // - Paid plan lasts until currentPeriodEnd.
  // - If not renewed, user effectively falls back to Free.
  // So for reporting, treat all users not on a paid plan at period end as Free.
  const paidUsersAtPeriodEndCount = paidUsersAtPeriodEnd.length;
  const effectiveUsersAtPeriodEndCount = scope === "global" ? totalUsersCount : 1;
  const effectivePaidUsersAtPeriodEndCount = scope === "global"
    ? paidUsersAtPeriodEndCount
    : paidUsersAtPeriodEndCount > 0
      ? 1
      : 0;
  const effectiveFreeUsersAtPeriodEndCount = Math.max(
    0,
    effectiveUsersAtPeriodEndCount - effectivePaidUsersAtPeriodEndCount,
  );

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
        totalUsersCount: scope === "global" ? totalUsersCount : null,
        newUsersCount: newUsers,
        subscriptionsActiveAtPeriodEndCount: activeSubscriptionsAtEnd,
        freeSubscriptionsActiveAtPeriodEndCount: freeSubscriptionsAtEnd,
        paidSubscriptionsActiveAtPeriodEndCount: paidSubscriptionsAtEnd,
        payingUsersInPeriodCount: payingUsersInPeriod.length,
        effectiveUsersAtPeriodEndCount,
        effectiveFreeUsersAtPeriodEndCount,
        effectivePaidUsersAtPeriodEndCount,
      },
      images: {
        uploadedCount: imagesCount,
        uploadedTotalSizeBytes: (imagesAgg._sum.sizeBytes ?? BigInt(0)).toString(),
        totalStoredSizeBytesAtPeriodEnd: (totalStorageAgg._sum.sizeBytes ?? BigInt(0)).toString(),
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
        activeAtPeriodEndCount: activeSubscriptionsAtEnd,
      },
      purchases: {
        count: purchasesCount,
        quantitySum: purchasesAgg._sum.quantity ?? 0,
        totalAmountSum: decimalToString(purchasesAgg._sum.totalAmount),
        paid: {
          count: paidPurchasesAgg._count._all,
          totalAmountSum: decimalToString(paidPurchasesAgg._sum.totalAmount),
          averageAmount: decimalToString(paidPurchasesAgg._avg.totalAmount),
        },
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
      spend: {
        paidPurchasesAmountSumInPeriod: paidPurchasesAmountInPeriod.toString(),
        paidPurchasesAmountSumToDate: paidPurchasesAmountToDate.toString(),
        payingUsersInPeriodCount,
        averageSpendPerPayingUserInPeriod,
        averageSpendPerUserInPeriod,
      },
      entitlements: {
        createdCount: entitlementsCreated,
      },
    },
    trends,
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
