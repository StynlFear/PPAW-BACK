import express from "express";

import { createUserProfileHandler } from "../controllers/userProfileController";
import {
	getUserPlanHandler,
	setUserPlanHandler,
} from "../controllers/subscriptionController";
import { getUserQuotaHandler } from "../controllers/quotaController";

const router = express.Router();

router.post("/", createUserProfileHandler);
router.get("/:userId/plan", getUserPlanHandler);
router.put("/:userId/plan", setUserPlanHandler);
router.get("/:userId/quota", getUserQuotaHandler);

export default router;
