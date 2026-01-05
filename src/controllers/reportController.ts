import type { Request, Response } from "express";

import { getUserProfileById } from "../models/uploadModel";
import {
  generateActivityReport,
  listReports,
  type ReportPeriod,
} from "../models/reportModel";
import { isUuid } from "../utils/validators";

function isReportPeriod(value: unknown): value is ReportPeriod {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

function isIsoDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// POST /reports/generate
// Body: { userId: uuid, period: day|week|month|year, date?: YYYY-MM-DD }
export async function generateReportHandler(req: Request, res: Response) {
  try {
    const userId = req.body?.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId (uuid) is required" });
    }

    const period = req.body?.period;
    if (!isReportPeriod(period)) {
      return res.status(400).json({ error: "period must be one of: day, week, month, year" });
    }

    // Admin report is always whole-app (global) for now.
    // (We intentionally do not support user-scoped reports here.)
    if (req.body?.scope !== undefined && req.body.scope !== "global") {
      return res.status(400).json({ error: "scope is not supported; admin reports are global" });
    }

    const date = req.body?.date;
    if (date !== undefined && !isIsoDateOnly(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }

    if (req.body?.targetUserId !== undefined) {
      return res.status(400).json({ error: "targetUserId is not supported; admin reports are global" });
    }

    const owner = await getUserProfileById(userId);
    if (!owner) {
      return res.status(404).json({ error: "user not found" });
    }

    const report = await generateActivityReport({
      ownerUserId: userId,
      period,
      anchorDate: date,
      scope: "global",
    });

    return res.status(201).json(report);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "INVALID_DATE"
    ) {
      return res.status(400).json({ error: "date must be a valid YYYY-MM-DD" });
    }
    return res.status(500).json({ error: "internal error" });
  }
}

// GET /reports?userId=<uuid>&type=<string>&limit=<int>
export async function listReportsHandler(req: Request, res: Response) {
  try {
    const userId = req.query.userId;
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "userId (uuid) is required" });
    }

    const type = typeof req.query.type === "string" ? req.query.type : undefined;

    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === "string" && limitRaw.trim() ? Number(limitRaw) : undefined;
    if (limit !== undefined && !Number.isInteger(limit)) {
      return res.status(400).json({ error: "limit must be an integer" });
    }

    const user = await getUserProfileById(userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    const reports = await listReports({ userId, type, limit });
    return res.json(reports);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
