import express from "express";

import {
  createWatermarkHandler,
  listWatermarksHandler,
} from "../controllers/watermarkController";

const router = express.Router();

router.get("/", listWatermarksHandler);
router.post("/", createWatermarkHandler);

export default router;
