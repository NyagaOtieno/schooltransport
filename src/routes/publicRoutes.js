// src/routes/publicRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================================================
   Helpers
   ========================================================= */

function getClientIp(req) {
  // x-forwarded-for may contain a list: "client, proxy1, proxy2"
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  if (Array.isArray(xf) && xf.length) return String(xf[0]).trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

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

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* =========================================================
   Simple in-memory rate limiter (no deps)
   - 120 requests per minute per IP per route
   - includes periodic cleanup to avoid memory growth
   ========================================================= */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

// key -> { count, resetAt }
const hits = new Map();
let lastCleanupAt = Date.now();

function rateLimit(req, res, next) {
  const ip = getClientIp(req);
  const routeKey = `${req.method}:${req.baseUrl}${req.path}`; // per-route limiting
  const key = `${ip}:${routeKey}`;
  const now = Date.now();

  // periodic cleanup
  if (now - lastCleanupAt > 5 * 60_000) {
    for (const [k, v] of hits.entries()) {
      if (!v || now > v.resetAt) hits.delete(k);
    }
    lastCleanupAt = now;
  }

  const record = hits.get(key);
  if (!record || now > record.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again shortly.",
      retryAfterSeconds,
    });
  }

  record.count += 1;
  hits.set(key, record);
  return next();
}

/* =========================================================
   Router policy
   ========================================================= */

// ✅ Require JWT for everything in this router
router.use(authMiddleware);

/**
 * ✅ AUTH: Get asset location by tag
 * GET /api/public/assets/:tag/location
 * Requires: Authorization: Bearer <token>
 */
router.get(
  "/assets/:tag/location",
  rateLimit,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const tag = String(req.params.tag || "").trim();
    if (!tag) {
      return res.status(400).json({ success: false, message: "Asset tag is required" });
    }

    // 1) Find asset by tag in THIS tenant only
    const asset = await prisma.asset.findFirst({
      where: { tag, TenantId: tenantId },
      select: {
        id: true,
        name: true,
        tag: true,
        busId: true,
        TenantId: true,
      },
    });

    if (!asset) {
      return res.status(404).json({ success: false, message: "Asset not found" });
    }

    // 2) Determine busId: prefer asset.busId, else fallback to latest manifest busId
    let busId = asset.busId ?? null;

    if (!busId) {
      const lastManifest = await prisma.manifest.findFirst({
        where: { assetId: asset.id },
        orderBy: { createdAt: "desc" },
        select: { busId: true },
      });
      busId = lastManifest?.busId ?? null;
    }

    if (!busId) {
      return res.status(200).json({
        success: true,
        asset: { name: asset.name, tag: asset.tag },
        bus: null,
        location: null,
        message: "Asset found, but it is not assigned to any vehicle yet.",
      });
    }

    // 3) Fetch bus, ensure bus belongs to same tenant
    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), TenantId: tenantId },
      select: {
        id: true,
        plateNumber: true,
        name: true,
        route: true,
      },
    });

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: "Bus not found for this tenant",
      });
    }

    // 4) Prefer LiveLocation, fallback to BusLocation
    const live = await prisma.liveLocation.findFirst({
      where: { busId: bus.id },
      orderBy: { lastUpdate: "desc" },
      select: {
        lat: true,
        lng: true,
        speed: true,
        direction: true,
        movementState: true,
        lastUpdate: true,
      },
    });

    if (live) {
      return res.status(200).json({
        success: true,
        asset: { name: asset.name, tag: asset.tag },
        bus,
        location: live,
      });
    }

    const last = await prisma.busLocation.findFirst({
      where: { busId: bus.id },
      orderBy: { lastUpdate: "desc" },
      select: {
        lat: true,
        lng: true,
        speed: true,
        direction: true,
        state: true,
        movement: true,
        lastUpdate: true,
      },
    });

    return res.status(200).json({
      success: true,
      asset: { name: asset.name, tag: asset.tag },
      bus,
      location: last || null,
    });
  })
);

/* =========================================================
   Error handler (keeps route clean)
   ========================================================= */
router.use((err, req, res, next) => {
  console.error("❌ publicRoutes error:", err);
  res.status(500).json({ success: false, message: "Server error" });
});

export default router;
