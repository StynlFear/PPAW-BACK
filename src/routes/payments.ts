import express from "express";

import { checkoutHandler } from "../controllers/paymentController";

const router = express.Router();

router.post("/checkout", checkoutHandler);

export default router;
