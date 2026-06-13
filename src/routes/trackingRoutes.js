// src/routes/trackingRoutes.js
// Real-time student location tracking.
// Subscription middleware auto-deducts wallet on each 24h window.
// Polls LiveLocation table — updated by the external GPS sync service.

import express from "express";
import * as trackingService from "../services/trackingSync.js";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import checkParentSubscription from "../middleware/checkParentSubscription.js";

const router = express.Router();

/* ── Rate limiter (per IP) ─────────────────────────────────── */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 200;   // ↑ raised for real-time polling
const hits           = new Map();

function rateLimit(req, res, next) {
  const ip  = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const r   = hits.get(ip);

  if (!r || now > r.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  if (r.count >= RATE_MAX) {
    return res.status(429).json({ success: false, message: "Too many requests." });
  }
  r.count++;
  hits.set(ip, r);
  next();
}

function ok(res, payload)            { return res.status(200).json({ success: true,  ...payload }); }
function fail(res, status, message)  { return res.status(status).json({ success: false, message }); }

/* ── All routes require JWT ────────────────────────────────── */
router.use(authMiddleware);

/* ============================================================
   GET /api/tracking/sync
   Manual GPS sync — ADMIN only
============================================================ */
router.get("/sync", async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") return fail(res, 403, "ADMIN only.");
    const result = await trackingService.syncLiveLocations();
    return ok(res, { data: result });
  } catch (err) {
    console.error("[tracking/sync]", err);
    return fail(res, 500, "Sync failed.");
  }
});

/* ============================================================
   GET /api/tracking/live-locations
   All live bus locations for this tenant
============================================================ */
router.get("/live-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return fail(res, 403, "Token missing tenantId.");

    const locations = await trackingService.getLiveLocations();
    const filtered  = Array.isArray(locations)
      ? locations.filter((x) => Number(x?.tenantId ?? x?.TenantId) === Number(tenantId))
      : [];

    return ok(res, { count: filtered.length, data: filtered });
  } catch (err) {
    console.error("[tracking/live-locations]", err);
    return fail(res, 500, "Failed to fetch live locations.");
  }
});

/* ============================================================
   GET /api/tracking/bus-locations
   Latest location per bus for this tenant
============================================================ */
router.get("/bus-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return fail(res, 403, "Token missing tenantId.");

    const buses    = await trackingService.getBusLocations();
    const filtered = Array.isArray(buses)
      ? buses.filter((b) => Number(b?.tenantId ?? b?.TenantId) === Number(tenantId))
      : [];

    return ok(res, { count: filtered.length, data: filtered });
  } catch (err) {
    console.error("[tracking/bus-locations]", err);
    return fail(res, 500, "Failed to fetch bus locations.");
  }
});

/* ============================================================
   GET /api/tracking/student/:studentId
   Live bus location for a parent's child.

   Middleware chain:
     authMiddleware → rateLimit → checkParentSubscription → handler

   checkParentSubscription:
     • Active subscription    → pass through (free)
     • No subscription        → deduct KES 10 → activate 24h → pass through
     • Insufficient balance   → 402 { code: "INSUFFICIENT_BALANCE" }

   Response when child is on trip:
     { success, status: "On trip", bus: { id, name, plateNumber },
       location: { lat, lng, speed, direction, movementState, lastUpdate } }

   Response when child is NOT on trip:
     { success, status: "Not onboarded" | "No trip found" | ..., location: null }
============================================================ */
router.get(
  "/student/:studentId",
  rateLimit,
  checkParentSubscription("studentId"),  // wallet deduction + subscription gate
  async (req, res) => {
    try {
      const tenantId  = Number(req.user?.tenantId);
      const studentId = Number(req.params.studentId);

      if (!tenantId)                      return fail(res, 403, "Token missing tenantId.");
      if (!Number.isFinite(studentId))    return fail(res, 400, "Invalid studentId.");

      // ── Verify student belongs to this tenant ────────────
      // ✅ Fixed: schema field is tenantId (lowercase) not TenantId
      const student = await prisma.student.findFirst({
        where:  { id: studentId, tenantId },
        select: { id: true, name: true, busId: true },
      });

      if (!student) return fail(res, 404, "Student not found for this tenant.");

      // ── Get latest manifest for this student ─────────────
      const manifest = await prisma.manifest.findFirst({
        where:   { studentId },
        orderBy: { createdAt: "desc" },
        select: {
          id:           true,
          busId:        true,
          status:       true,
          session:      true,
          boardingTime: true,
          latitude:     true,
          longitude:    true,
          createdAt:    true,
        },
      });

      if (!manifest) {
        return ok(res, { location: null, status: "No trip found" });
      }

      // ── Boarding check ───────────────────────────────────
      if (manifest.status !== "CHECKED_IN") {
        return ok(res, { location: null, status: "Not onboarded" });
      }

      // ── Resolve bus ──────────────────────────────────────
      const busId = manifest.busId || student.busId;
      if (!busId) return ok(res, { location: null, status: "No bus assigned" });

      // ✅ Fixed: tenantId not TenantId
      const bus = await prisma.bus.findFirst({
        where:  { id: Number(busId), tenantId },
        select: { id: true, plateNumber: true, name: true },
      });

      if (!bus) return ok(res, { location: null, status: "Bus not found for tenant" });

      // ── Try LiveLocation first (real-time GPS) ───────────
      const live = await prisma.liveLocation.findFirst({
        where:   { busId: bus.id },
        orderBy: { lastUpdate: "desc" },
        select: {
          lat:          true,
          lng:          true,
          speed:        true,
          direction:    true,
          movementState: true,
          lastUpdate:   true,
        },
      });

      if (live) {
        // Check location is recent (within 10 minutes)
        const ageMs     = Date.now() - new Date(live.lastUpdate).getTime();
        const isRecent  = ageMs < 10 * 60 * 1000;

        return ok(res, {
          status:   isRecent ? "On trip" : "On trip (manifest coords)",
          bus,
          location: live,
          walletDeducted: req.walletDeducted ?? false,
          newBalance:     req.walletBalance  ?? undefined,
        });
      }

      // ── Fallback: manifest coordinates ───────────────────
      if (manifest.latitude != null && manifest.longitude != null) {
        return ok(res, {
          status: "On trip (manifest coords)",
          bus,
          location: {
            lat:        manifest.latitude,
            lng:        manifest.longitude,
            speed:      null,
            direction:  null,
            lastUpdate: manifest.createdAt,
          },
          walletDeducted: req.walletDeducted ?? false,
        });
      }

      return ok(res, {
        location: null,
        status:   "On trip, but no location data yet",
        bus,
      });

    } catch (err) {
      console.error("[tracking/student]", err);
      return fail(res, 500, "Failed to fetch student tracking.");
    }
  }
);

/* ============================================================
   GET /api/tracking/bus/:busId
   Direct bus location — for DRIVER/ASSISTANT/ADMIN roles
============================================================ */
router.get("/bus/:busId", rateLimit, async (req, res) => {
  try {
    const tenantId = Number(req.user?.tenantId);
    const busId    = Number(req.params.busId);
    const role     = req.user?.role?.toUpperCase();

    if (!["ADMIN", "DRIVER", "ASSISTANT"].includes(role)) {
      return fail(res, 403, "Not authorized.");
    }

    const bus = await prisma.bus.findFirst({
      where:  { id: busId, tenantId },
      select: { id: true, name: true, plateNumber: true },
    });

    if (!bus) return fail(res, 404, "Bus not found.");

    const live = await prisma.liveLocation.findFirst({
      where:   { busId: bus.id },
      orderBy: { lastUpdate: "desc" },
    });

    if (!live) return ok(res, { location: null, status: "No location data", bus });

    return ok(res, {
      status:   "Live",
      bus,
      location: {
        lat:          live.lat,
        lng:          live.lng,
        speed:        live.speed,
        direction:    live.direction,
        movementState: live.movementState,
        lastUpdate:   live.lastUpdate,
      },
    });
  } catch (err) {
    console.error("[tracking/bus]", err);
    return fail(res, 500, "Failed to fetch bus location.");
  }
});

export default router;