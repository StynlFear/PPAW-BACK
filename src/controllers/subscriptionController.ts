import type { Request, Response } from "express";

import { listSubscriptionsForUser, setUserActivePlan } from "../models/subscriptionModel";
import { getUserActivePlan } from "../models/userPlanModel";
import { getUserProfileById } from "../models/uploadModel";
import { isUuid } from "../utils/validators";

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
