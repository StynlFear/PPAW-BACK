import type { Request, Response } from "express";

import { fakeCheckout } from "../models/paymentModel";
import { isUuid } from "../utils/validators";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

// POST /payments/checkout
// Body: {
//   userId: uuid,
//   planId?: int,
//   amount?: string|number,
//   currency?: string,
//   card: { firstName,lastName,number,expMonth,expYear,cvc }
// }
export async function checkoutHandler(req: Request, res: Response) {
  try {
    const userId = req.body?.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId (uuid) is required" });
    }

    const planIdRaw = req.body?.planId;
    const planId = planIdRaw === undefined ? undefined : Number(planIdRaw);
    if (planId !== undefined && !Number.isInteger(planId)) {
      return res.status(400).json({ error: "planId must be an integer" });
    }

    const currency = req.body?.currency;
    if (currency !== undefined && !isNonEmptyString(currency)) {
      return res.status(400).json({ error: "currency must be a string" });
    }

    const amount = req.body?.amount;
    if (
      amount !== undefined &&
      !(typeof amount === "number" || (typeof amount === "string" && amount.trim().length > 0))
    ) {
      return res.status(400).json({ error: "amount must be a number or numeric string" });
    }

    const card = req.body?.card;
    if (!card || typeof card !== "object") {
      return res.status(400).json({ error: "card is required" });
    }

    const firstName = (card as any).firstName;
    const lastName = (card as any).lastName;
    const number = (card as any).number;
    const expMonth = (card as any).expMonth;
    const expYear = (card as any).expYear;
    const cvc = (card as any).cvc;

    if (!isNonEmptyString(firstName) || !isNonEmptyString(lastName)) {
      return res.status(400).json({ error: "card.firstName and card.lastName are required" });
    }
    if (!isNonEmptyString(number)) {
      return res.status(400).json({ error: "card.number is required" });
    }
    if (!isInt(expMonth) || !isInt(expYear)) {
      return res.status(400).json({ error: "card.expMonth and card.expYear must be integers" });
    }
    if (!isNonEmptyString(cvc)) {
      return res.status(400).json({ error: "card.cvc is required" });
    }

    const result = await fakeCheckout({
      userId,
      planId,
      amount,
      currency,
      card: { firstName, lastName, number, expMonth, expYear, cvc },
    });

    if (!result.ok) {
      return res.status(402).json({
        ok: false,
        reason: result.reason,
        payment: result.payment,
      });
    }

    return res.status(201).json({
      ok: true,
      payment: result.payment,
      subscription: result.subscription,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);

    const code =
      typeof err === "object" && err !== null && "code" in err ? (err as any).code : undefined;

    if (code === "USER_NOT_FOUND") return res.status(404).json({ error: "user not found" });
    if (code === "PLAN_NOT_FOUND") return res.status(404).json({ error: "plan not found" });
    if (code === "AMOUNT_REQUIRED") return res.status(400).json({ error: "amount is required" });

    return res.status(500).json({ error: "internal error" });
  }
}
