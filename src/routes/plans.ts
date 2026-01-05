import express from "express";

import {
  listPlanFiltersHandler,
  listPlansHandler,
  replacePlanFiltersHandler,
} from "../controllers/subscriptionPlanController";

const router = express.Router();

router.get("/", listPlansHandler);
router.get("/:planId/filters", listPlanFiltersHandler);
router.put("/:planId/filters", replacePlanFiltersHandler);

export default router;
