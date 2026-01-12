import type { Request, Response } from "express";

import { listSubscriptionsForUser, setUserActivePlan } from "../models/subscriptionModel";
import { fakeCheckout } from "../models/paymentModel";
import { getSubscriptionPlanById } from "../models/subscriptionPlanModel";
import { getUserActivePlan } from "../models/userPlanModel";
import { getUserProfileById } from "../models/uploadModel";
import { isUuid } from "../utils/validators";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export async function getUserPlanHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const active = await getUserActivePlan(userId);
    if (!active || !active.plan) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }

    return res.json(active);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

export async function setUserPlanHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const planId = req.body?.planId;
    if (typeof planId !== "number" || !Number.isInteger(planId)) {
      return res.status(400).json({ error: "planId (integer) is required" });
    }

    const plan = await getSubscriptionPlanById(planId);
    if (!plan) {
      return res.status(404).json({ error: "plan not found" });
    }

    // If plan is free, allow switching without payment.
    // If plan is paid, require payment details (or use /payments/checkout directly).
    const isPaidPlan = Number(plan.price.toString()) > 0;
    if (isPaidPlan) {
      const card = req.body?.card;
      if (!card || typeof card !== "object") {
        return res.status(409).json({
          error:
            "payment required for paid plan; use POST /payments/checkout or include card details in this request",
        });
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

      const checkout = await fakeCheckout({
        userId,
        planId,
        // Use plan currency semantics via request currency if provided; default handled in model.
        currency: req.body?.currency,
        card: { firstName, lastName, number, expMonth, expYear, cvc },
      });

      if (!checkout.ok) {
        return res.status(402).json({
          error: checkout.reason,
          payment: checkout.payment,
        });
      }

      if (!checkout.subscription) {
        return res.status(500).json({ error: "payment succeeded but subscription was not created" });
      }

      // Preserve existing response shape: return the subscription.
      return res.status(201).json(checkout.subscription);
    }

    const result = await setUserActivePlan({ userId, planId });
    if (!result.ok && result.reason === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "user not found" });
    }
    if (!result.ok && result.reason === "PLAN_NOT_FOUND") {
      return res.status(404).json({ error: "plan not found" });
    }

    return res.status(201).json(result.subscription);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// List all subscriptions for a user
// GET /users/:userId/subscriptions
export async function listUserSubscriptionsHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const subscriptions = await listSubscriptionsForUser(userId);
    return res.json(subscriptions);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Get current (active) subscription for a user
// GET /users/:userId/subscriptions/current
export async function getUserCurrentSubscriptionHandler(req: Request, res: Response) {
  try {
    const userId = req.params.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId must be a uuid" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const active = await getUserActivePlan(userId);
    if (!active || !active.plan) {
      return res.status(409).json({ error: "user has no active subscription plan" });
    }

    return res.json(active);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
