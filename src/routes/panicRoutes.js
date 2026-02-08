// src/routes/panicRoutes.js
import express from "express";
import { triggerPanic } from "../controllers/panicController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Require tenantId from token (multi-tenant safety)
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
 * Only allow roles that can raise panic
 * (Update this list to match your enum)
 */
function allowRoles(allowed) {
  return (req, res, next) => {
    const role = String(req.user?.role || "").toUpperCase();
    if (!allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: role ${role || "UNKNOWN"} not allowed`,
      });
    }
    return next();
  };
}

/**
 * POST /api/panic
 * - Auth required
 * - Tenant required
 * - Role allowed (includes CLIENT / MERCHANT)
 */
router.post(
  "/",
  authMiddleware,
  (req, res, next) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    // optional convenience
    req.tenantId = tenantId;
    next();
  },
  allowRoles(["ADMIN", "DRIVER", "ASSISTANT", "PARENT", "CLIENT", "MERCHANT"]),
  triggerPanic
);

export default router;
