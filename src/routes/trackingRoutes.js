// src/routes/trackingRoutes.js
import express from "express";
import * as trackingService from "../services/trackingSync.js";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import checkParentSubscription from "../middleware/checkParentSubscription.js";


const router = express.Router();

/* ==============================
   Helpers (UNCHANGED LOGIC)
============================== */

const getTenantId = (req) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return null;
  return Number(tenantId);
};

const parseId = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ok = (res, data = {}) =>
  res.status(200).json({ success: true, ...data });

const fail = (res, status, message, detail) =>
  res.status(status).json({
    success: false,
    message,
    ...(detail ? { detail } : {}),
  });

/* ==============================
   RATE LIMIT (SAFE + CLEANUP)
============================== */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

const hits = new Map();

// cleanup (prevents memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of hits.entries()) {
    if (data.resetAt < now) hits.delete(ip);
  }
}, 60_000);

const rateLimit = (req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    "unknown";

  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_MAX) {
    return fail(res, 429, "Too many requests. Slow down.");
  }

  entry.count++;
  return next();
};

/* ==============================
   GLOBAL AUTH (UNCHANGED)
============================== */

router.use(authMiddleware);

/* ==============================
   ADMIN SYNC (UNCHANGED)
============================== */

router.get("/sync", async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return fail(res, 403, "ADMIN only endpoint");
    }

    const result = await trackingService.syncLiveLocations();
    return ok(res, { data: result });
  } catch (err) {
    console.error("sync error:", err);
    return fail(res, 500, "Sync failed");
  }
});

/* ==============================
   LIVE LOCATIONS (OPTIMIZED QUERY ONLY)
============================== */

router.get("/live-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return fail(res, 403, "Missing tenantId");

    const data = await prisma.liveLocation.findMany({
      where: {
        bus: { tenantId },
      },
      orderBy: { lastUpdate: "desc" },
    });

    return ok(res, { count: data.length, data });
  } catch (err) {
    console.error("live-locations error:", err);
    return fail(res, 500, "Failed to fetch live locations");
  }
});

/* ==============================
   BUS LOCATIONS (UNCHANGED LOGIC)
============================== */

router.get("/bus-locations", rateLimit, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return fail(res, 403, "Missing tenantId");

    const data = await prisma.bus.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        plateNumber: true,
        liveLocations: {
          orderBy: { lastUpdate: "desc" },
          take: 1,
        },
      },
    });

    return ok(res, { count: data.length, data });
  } catch (err) {
    console.error("bus-locations error:", err);
    return fail(res, 500, "Failed to fetch bus locations");
  }
});

/* ==============================
   STUDENT TRACKING (BILLING SAFE - NO LOGIC CHANGE)
============================== */

router.get(
  "/student/:studentId",
  rateLimit,
  checkParentSubscription("studentId"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return fail(res, 403, "Missing tenantId");

      const studentId = parseId(req.params.studentId);
      if (!studentId) return fail(res, 400, "Invalid studentId");

      // OPTIMIZED QUERY (unchanged behavior)
      const student = await prisma.student.findFirst({
        where: { id: studentId, tenantId },
        select: {
          id: true,
          name: true,
          busId: true,
          manifest: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              busId: true,
              status: true,
              latitude: true,
              longitude: true,
              createdAt: true,
            },
          },
        },
      });

      if (!student) {
        return fail(res, 404, "Student not found");
      }

      const manifest = student.manifest?.[0];

      if (!manifest) {
        return ok(res, { location: null, status: "No trip found" });
      }

      if (manifest.status !== "CHECKED_IN") {
        return ok(res, { location: null, status: "Not onboarded" });
      }

      const busId = manifest.busId || student.busId;

      if (!busId) {
        return ok(res, { location: null, status: "No bus assigned" });
      }

      // SAFE QUERY (keeps tenant isolation)
      const live = await prisma.liveLocation.findFirst({
        where: {
          busId,
          bus: { tenantId },
        },
        orderBy: { lastUpdate: "desc" },
      });

      const bus = await prisma.bus.findFirst({
        where: { id: busId, tenantId },
        select: {
          id: true,
          name: true,
          plateNumber: true,
        },
      });

      if (!bus) {
        return ok(res, { location: null, status: "Bus not found" });
      }

      if (live) {
        return ok(res, {
          status: "On trip",
          bus,
          location: live,
        });
      }

      // IMPORTANT FIX: avoid falsy GPS bug (0 values)
      if (manifest.latitude != null && manifest.longitude != null) {
        return ok(res, {
          status: "On trip (cached)",
          bus,
          location: {
            lat: manifest.latitude,
            lng: manifest.longitude,
            lastUpdate: manifest.createdAt,
          },
        });
      }

      return ok(res, {
        location: null,
        status: "On trip, no GPS data yet",
      });
    } catch (err) {
      console.error("student tracking error:", err);
      return fail(res, 500, "Tracking failed");
    }
  }
);

export default router;