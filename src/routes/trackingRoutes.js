// src/routes/trackingRoutes.js
import express from "express";
import * as trackingService from "../services/trackingSync.js";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* ==============================
   Helpers
============================== */

function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return Number(tenantId);
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Simple rate limit (per IP)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    "unknown";

  const now = Date.now();
  const r = hits.get(ip);

  if (!r || now > r.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }

  if (r.count >= RATE_MAX) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again shortly.",
    });
  }

  r.count += 1;
  hits.set(ip, r);
  next();
}

function ok(res, payload) {
  return res.status(200).json({ success: true, ...payload });
}

function fail(res, status, message, detail) {
  return res.status(status).json({ success: false, message, ...(detail ? { detail } : {}) });
}

/* ==============================
   Routes (JWT required)
============================== */

router.use(authMiddleware);

/**
 * GET /api/tracking/sync
 * Trigger manual sync from external live location API
 * ✅ Suggested: ADMIN-only
 */
router.get("/sync", async (req, res) => {
  try {
    // Optional: restrict sync
    if (req.user?.role !== "ADMIN") {
      return fail(res, 403, "Forbidden: ADMIN only");
    }

    const result = await trackingService.syncLiveLocations();
    return ok(res, { data: result });
  } catch (err) {
    console.error("❌ Sync endpoint error:", err);
    return fail(res, 500, "Server error during sync", err?.message);
  }
});

/**
 * GET /api/tracking/live-locations
 * Get all live locations for THIS tenant only
 */
router.get("/live-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    // If your service supports tenant filtering, pass tenantId:
    // const locations = await trackingService.getLiveLocations({ tenantId });
    const locations = await trackingService.getLiveLocations();

    // Tenant-scope filter (fallback if service returns everything)
    const filtered = Array.isArray(locations)
      ? locations.filter((x) => Number(x?.TenantId ?? x?.tenantId) === tenantId || Number(x?.tenantId) === tenantId)
      : [];

    return ok(res, { count: filtered.length, data: filtered });
  } catch (err) {
    console.error("❌ Live locations endpoint error:", err);
    return fail(res, 500, "Server error fetching live locations", err?.message);
  }
});

/**
 * GET /api/tracking/bus-locations
 * Latest location for all buses in THIS tenant
 */
router.get("/bus-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    // If your service supports tenant filtering, pass tenantId:
    // const buses = await trackingService.getBusLocations({ tenantId });
    const buses = await trackingService.getBusLocations();

    const filtered = Array.isArray(buses)
      ? buses.filter((b) => Number(b?.TenantId ?? b?.tenantId) === tenantId)
      : [];

    return ok(res, { count: filtered.length, data: filtered });
  } catch (err) {
    console.error("❌ Bus locations endpoint error:", err);
    return fail(res, 500, "Server error fetching bus locations", err?.message);
  }
});

/**
 * GET /api/tracking/student/:studentId
 * Returns:
 * - current bus live location if the student is currently onboarded
 * - else null with status message
 *
 * ✅ Tenant-safe
 */
router.get("/student/:studentId", rateLimit, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const studentId = parseId(req.params.studentId);
    if (!studentId) return fail(res, 400, "Invalid studentId");

    // Ensure student belongs to tenant
    const student = await prisma.student.findFirst({
      where: { id: studentId, TenantId: tenantId },
      select: { id: true, name: true, busId: true },
    });

    if (!student) return fail(res, 404, "Student not found for this tenant");

    // Latest manifest for this student today-ish
    const manifest = await prisma.manifest.findFirst({
      where: { studentId: studentId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        busId: true,
        status: true,
        session: true,
        boardingTime: true,
        alightingTime: true,
        latitude: true,
        longitude: true,
        createdAt: true,
      },
    });

    if (!manifest) {
      return ok(res, { location: null, status: "No trip found" });
    }

    // Determine if currently onboarded:
    // - if last status is CHECKED_IN and no CHECKED_OUT after it
    const isCheckedIn = manifest.status === "CHECKED_IN";
    const isCheckedOut = manifest.status === "CHECKED_OUT";

    if (!isCheckedIn || isCheckedOut) {
      return ok(res, { location: null, status: "Not onboarded" });
    }

    // Prefer LiveLocation for the bus
    const busId = manifest.busId || student.busId;

    if (!busId) {
      return ok(res, { location: null, status: "No bus assigned" });
    }

    // Tenant-safe bus check
    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), TenantId: tenantId },
      select: { id: true, plateNumber: true, name: true },
    });

    if (!bus) {
      return ok(res, { location: null, status: "Bus not found for tenant" });
    }

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
      return ok(res, {
        status: "On trip",
        bus,
        location: live,
      });
    }

    // Fallback: manifest coordinates (if you capture them)
    if (manifest.latitude != null && manifest.longitude != null) {
      return ok(res, {
        status: "On trip (manifest coords)",
        bus,
        location: { lat: manifest.latitude, lng: manifest.longitude, lastUpdate: manifest.createdAt },
      });
    }

    return ok(res, { location: null, status: "On trip, but no location data yet" });
  } catch (err) {
    console.error("❌ Error fetching student tracking:", err);
    return fail(res, 500, "Server error fetching student tracking", err?.message);
  }
});

export default router;
