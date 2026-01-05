import express from "express";

import {
	listFiltersHandler,
	listUserAllowedFiltersHandler,
} from "../controllers/filterController";

const router = express.Router();

router.get("/", listFiltersHandler);
router.get("/:userId", listUserAllowedFiltersHandler);

export default router;
