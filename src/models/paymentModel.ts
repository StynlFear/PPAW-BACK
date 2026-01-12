import { Prisma } from "@prisma/client";

import prisma from "../config/db";

export type FakeCardInput = {
  firstName: string;
  lastName: string;
  number: string;
  expMonth: number;
  expYear: number; // 2-digit or 4-digit
  cvc: string;
};

export type FakeCheckoutInput = {
  userId: string;
  planId?: number;
  // Optional override (e.g. for UI demo). If omitted and planId provided, uses plan.price.
  amount?: string | number;
  currency?: string;
  card: FakeCardInput;
};

function normalizeDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function luhnCheck(cardNumberDigits: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let i = cardNumberDigits.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumberDigits[i]);
    if (Number.isNaN(digit)) return false;

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeExpYear(expYear: number): number {
  if (expYear >= 0 && expYear <= 99) return 2000 + expYear;
  return expYear;
}

function isExpiredUtc(expMonth: number, expYear: number): boolean {
  const year = normalizeExpYear(expYear);
  if (year < 2000 || year > 2100) return true;
  if (expMonth < 1 || expMonth > 12) return true;

  // Expiry is end of month.
  const expiryEnd = new Date(Date.UTC(year, expMonth, 1, 0, 0, 0, 0)); // first day of next month
  const now = new Date();
  return now.getTime() >= expiryEnd.getTime();
}

function detectBrand(cardNumberDigits: string): string {
  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(cardNumberDigits)) return "visa";
  if (/^(5[1-5]|2[2-7])\d{14}$/.test(cardNumberDigits)) return "mastercard";
  if (/^3[47]\d{13}$/.test(cardNumberDigits)) return "amex";
  if (/^6(?:011|5\d{2})\d{12}$/.test(cardNumberDigits)) return "discover";
  return "card";
}

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

function normalizeAmount(amount: string | number): Prisma.Decimal {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new Error("INVALID_AMOUNT");
    return new Prisma.Decimal(amount.toFixed(2));
  }

  const trimmed = amount.trim();
  if (!trimmed) throw new Error("INVALID_AMOUNT");
  // Basic numeric string validation
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error("INVALID_AMOUNT");
  return new Prisma.Decimal(trimmed);
}

function simulateCardDecision(card: FakeCardInput): { ok: boolean; reason?: string } {
  const numberDigits = normalizeDigits(card.number);
  if (numberDigits.length < 12 || numberDigits.length > 19) return { ok: false, reason: "invalid_card_number" };
  if (!luhnCheck(numberDigits)) return { ok: false, reason: "invalid_card_number" };

  if (isExpiredUtc(card.expMonth, card.expYear)) return { ok: false, reason: "expired_card" };

  const cvcDigits = normalizeDigits(card.cvc);
  if (!(cvcDigits.length === 3 || cvcDigits.length === 4)) return { ok: false, reason: "invalid_cvc" };

  // Handy test cases:
  // - 4000 0000 0000 0002 => declined
  // - cvc 000 => declined
  if (numberDigits.endsWith("0002")) return { ok: false, reason: "card_declined" };
  if (cvcDigits === "000") return { ok: false, reason: "card_declined" };

  return { ok: true };
}

export async function fakeCheckout(input: FakeCheckoutInput): Promise<
  | {
      ok: true;
      payment: { id: number; status: string; amount: string; currency: string; method: string | null; createdAt: Date | null };
      subscription: { id: number; planId: number; status: string; currentPeriodStart: Date; currentPeriodEnd: Date } | null;
    }
  | {
      ok: false;
      reason: string;
      payment: { id: number; status: string; amount: string; currency: string; method: string | null; createdAt: Date | null };
    }
> {
  const user = await prisma.userProfile.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) {
    const err = new Error("USER_NOT_FOUND");
    (err as unknown as { code?: string }).code = "USER_NOT_FOUND";
    throw err;
  }

  const card = input.card;
  const decision = simulateCardDecision(card);

  const numberDigits = normalizeDigits(card.number);
  const last4 = numberDigits.slice(-4);
  const brand = detectBrand(numberDigits);
  const method = `card:${brand}:****${last4}`;

  const currency = (input.currency ?? "USD").toUpperCase();

  const plan =
    typeof input.planId === "number" && Number.isInteger(input.planId)
      ? await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } })
      : null;

  if (input.planId !== undefined && !plan) {
    const err = new Error("PLAN_NOT_FOUND");
    (err as unknown as { code?: string }).code = "PLAN_NOT_FOUND";
    throw err;
  }

  const amountDecimal =
    input.amount !== undefined
      ? normalizeAmount(input.amount)
      : plan
        ? new Prisma.Decimal(plan.price.toString())
        : null;

  if (!amountDecimal) {
    const err = new Error("AMOUNT_REQUIRED");
    (err as unknown as { code?: string }).code = "AMOUNT_REQUIRED";
    throw err;
  }

  // If declined, still record a payment attempt (no subscription changes).
  if (!decision.ok) {
    const payment = await prisma.payment.create({
      data: {
        userId: input.userId,
        amount: amountDecimal,
        currency,
        method,
        status: "failed",
      },
      select: { id: true, status: true, amount: true, currency: true, method: true, createdAt: true },
    });

    return {
      ok: false,
      reason: decision.reason ?? "payment_failed",
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount.toString(),
        currency: payment.currency,
        method: payment.method,
        createdAt: payment.createdAt ?? null,
      },
    };
  }

  // Success: optionally activate plan + record payment tied to subscription.
  return prisma.$transaction(async (tx) => {
    let createdSubscription: {
      id: number;
      planId: number;
      status: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    } | null = null;

    if (plan) {
      const now = new Date();

      await tx.subscription.updateMany({
        where: { userId: input.userId, status: "active" },
        data: { status: "cancelled", currentPeriodEnd: now },
      });

      const end = addPeriod(now, plan.period);

      createdSubscription = await tx.subscription.create({
        data: {
          userId: input.userId,
          planId: plan.id,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: end,
        },
        select: {
          id: true,
          planId: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
        },
      });
    }

    const payment = await tx.payment.create({
      data: {
        userId: input.userId,
        subscriptionId: createdSubscription?.id,
        amount: amountDecimal,
        currency,
        method,
        status: "succeeded",
      },
      select: { id: true, status: true, amount: true, currency: true, method: true, createdAt: true },
    });

    return {
      ok: true,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount.toString(),
        currency: payment.currency,
        method: payment.method,
        createdAt: payment.createdAt ?? null,
      },
      subscription: createdSubscription,
    };
  });
}
