import express from "express";

import { createUserProfileHandler } from "../controllers/userProfileController";
import {
	getUserCurrentSubscriptionHandler,
	getUserPlanHandler,
	listUserSubscriptionsHandler,
	setUserPlanHandler,
} from "../controllers/subscriptionController";
import { getUserQuotaHandler } from "../controllers/quotaController";

const router = express.Router();

router.post("/", createUserProfileHandler);
router.get("/:userId/plan", getUserPlanHandler);
router.put("/:userId/plan", setUserPlanHandler);

router.get("/:userId/subscriptions", listUserSubscriptionsHandler);
router.get("/:userId/subscriptions/current", getUserCurrentSubscriptionHandler);

router.get("/:userId/quota", getUserQuotaHandler);

export default router;
