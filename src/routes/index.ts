import express from "express";

import authRouter from "./auth";
import { requireAuth } from "../middleware/auth";
import { meHandler } from "../controllers/authController";
import filtersRouter from "./filters";
import imagesRouter from "./images";
import plansRouter from "./plans";
import usersRouter from "./users";
import watermarksRouter from "./watermarks";
import reportsRouter from "./reports";
import paymentsRouter from "./payments";

const router = express.Router();

router.get("/me", requireAuth, meHandler);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/images", imagesRouter);
router.use("/filters", filtersRouter);
router.use("/plans", plansRouter);
router.use("/watermarks", watermarksRouter);
router.use("/reports", reportsRouter);
router.use("/payments", paymentsRouter);

export default router;
