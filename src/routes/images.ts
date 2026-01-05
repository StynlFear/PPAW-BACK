import express from "express";

import {
  applyFilterHandler,
  deleteAppliedFilterHandler,
  getFilterHistoryHandler,
  getLatestAppliedFiltersHandler,
} from "../controllers/filterController";
import {
  applyWatermarksHandler,
  deleteLatestWatermarksHandler,
  getLatestWatermarksHandler,
  getWatermarkHistoryHandler,
} from "../controllers/watermarkController";
import {
  uploadImageHandler,
  uploadSingleFile,
} from "../controllers/uploadController";

const router = express.Router();

router.post("/upload", uploadSingleFile, uploadImageHandler);

router.post("/:imageId/filters", applyFilterHandler);

router.get("/:imageId/filters", getLatestAppliedFiltersHandler);

router.get("/:imageId/filters/history", getFilterHistoryHandler);

router.delete("/:imageId/filters/:filterId", deleteAppliedFilterHandler);

router.post("/:imageId/watermarks", applyWatermarksHandler);
router.get("/:imageId/watermarks", getLatestWatermarksHandler);
router.get("/:imageId/watermarks/history", getWatermarkHistoryHandler);
router.delete("/:imageId/watermarks/:watermarkId", deleteLatestWatermarksHandler);

export default router;
