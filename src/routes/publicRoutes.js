// src/routes/publicRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Simple in-memory rate limiter (no dependencies)
 * - 120 requests per minute per IP (adjust as needed)
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const hits = new Map(); // ip -> { count, resetAt }

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();

  const record = hits.get(ip);
  if (!record || now > record.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again in a moment.",
    });
  }

  record.count += 1;
  hits.set(ip, record);
  next();
}

// ✅ Require JWT for everything in this router
router.use(authMiddleware);

/**
 * ✅ AUTH: Get asset location by tag
 * GET /api/public/assets/:tag/location
 * Requires: Authorization: Bearer <token>
 */
router.get("/assets/:tag/location", rateLimit, async (req, res) => {
  try {
    const rawTag = req.params.tag || "";
    const tag = rawTag.toString().trim();

    if (!tag) {
      return res.status(400).json({ success: false, message: "Asset tag is required" });
    }

    // ✅ You MUST have schoolId in token payload for proper scoping
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: token missing schoolId",
      });
    }

    // 1) Find asset by tag in THIS school only
    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId },
      select: {
        id: true,
        name: true,
        tag: true,
        busId: true,
        schoolId: true,
      },
    });

    if (!asset) {
      return res.status(404).json({ success: false, message: "Asset not found" });
    }

    // 2) Determine busId: prefer asset.busId, else fallback to latest manifest busId
    let busId = asset.busId;

    if (!busId) {
      const lastManifest = await prisma.manifest.findFirst({
        where: { assetId: asset.id },
        orderBy: { createdAt: "desc" },
        select: { busId: true },
      });
      busId = lastManifest?.busId || null;
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

    // 3) Fetch bus, ensure bus belongs to same school
    const bus = await prisma.bus.findFirst({
      where: { id: busId, schoolId },
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
        message: "Bus not found for this school",
      });
    }

    // 4) Prefer LiveLocation, fallback to BusLocation
    const live = await prisma.liveLocation.findFirst({
      where: { busId },
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
      where: { busId },
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
  } catch (error) {
    console.error("❌ Auth asset tracking error:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset location" });
  }
});

export default router;
