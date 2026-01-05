import express from "express";

import { generateReportHandler, listReportsHandler } from "../controllers/reportController";

const router = express.Router();

router.post("/generate", generateReportHandler);
router.get("/", listReportsHandler);

export default router;
