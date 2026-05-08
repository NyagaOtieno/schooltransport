// src/routes/notificationRoutes.js
import express from "express";
import sendNotification from "../controllers/notification.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Ensure tenantId exists on token for multi-tenant safety
 */
function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  const n = Number(tenantId);
  if (!Number.isFinite(n)) {
    res.status(400).json({ success: false, message: "Invalid tenantId in token" });
    return null;
  }
  return n;
}

/**
 * POST /api/notifications/send
 * - Protected
 * - Tenant-safe (controller can now scope by req.user.tenantId)
 */
router.post("/send", authMiddleware, (req, res, next) => {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;

  // Optional: attach normalized tenantId (already in req.user, but this makes it explicit)
  req.tenantId = tenantId;

  return sendNotification(req, res, next);
});

export default router;
