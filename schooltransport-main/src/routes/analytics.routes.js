import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  platformAnalytics,
  tenantAnalytics,
} from "../controllers/analytics.controller.js";

const router = express.Router();

router.use(authMiddleware);

/**
 * PLATFORM ADMIN DASHBOARD
 */
router.get("/platform", platformAnalytics);

/**
 * TENANT DASHBOARD (school)
 */
router.get("/tenant/:tenantId", tenantAnalytics);

export default router;