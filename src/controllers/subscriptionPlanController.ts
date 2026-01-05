import type { Request, Response } from "express";

import {
  listSubscriptionPlans,
  listFiltersForPlan,
  replacePlanFilters,
} from "../models/subscriptionPlanModel";

function parseIntParam(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export async function listPlansHandler(_req: Request, res: Response) {
  try {
    const plans = await listSubscriptionPlans();
    return res.json(plans);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

export async function listPlanFiltersHandler(req: Request, res: Response) {
  try {
    const planId = parseIntParam(req.params.planId);
    if (planId === null) {
      return res.status(400).json({ error: "planId (integer) is required" });
    }

    const filters = await listFiltersForPlan(planId);
    return res.json(filters);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

// Replace all filters linked to a plan.
// PUT /plans/:planId/filters
// Body: { filterIds: number[] }
export async function replacePlanFiltersHandler(req: Request, res: Response) {
  try {
    const planId = parseIntParam(req.params.planId);
    if (planId === null) {
      return res.status(400).json({ error: "planId (integer) is required" });
    }

    const filterIds = req.body?.filterIds;
    if (!Array.isArray(filterIds)) {
      return res.status(400).json({ error: "filterIds (array of integers) is required" });
    }

    const normalized: number[] = [];
    for (const v of filterIds) {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        return res.status(400).json({ error: "filterIds must contain only integers" });
      }
      normalized.push(v);
    }

    const unique = Array.from(new Set(normalized)).sort((a, b) => a - b);

    const result = await replacePlanFilters({ planId, filterIds: unique });
    if (!result.ok && result.reason === "PLAN_NOT_FOUND") {
      return res.status(404).json({ error: "plan not found" });
    }
    if (!result.ok && result.reason === "FILTER_NOT_FOUND") {
      return res.status(404).json({ error: `filter(s) not found: ${result.missing.join(",")}` });
    }

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
