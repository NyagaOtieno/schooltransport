import express from "express";
import * as trackingService from "../services/trackingSync.js";
import prisma from "../middleware/prisma.js"; // Prisma import for DB access

const router = express.Router();

// -----------------------------
// GET /api/tracking/sync
// Trigger manual sync from Loc8 API
// -----------------------------
router.get("/sync", async (req, res) => {
  try {
    const result = await trackingService.syncLiveLocations();
    res.json(result);
  } catch (err) {
    console.error("❌ Sync endpoint error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------
// GET /api/tracking/live-locations
// Get all live locations (students & vehicles)
// -----------------------------
router.get("/live-locations", async (req, res) => {
  try {
    const locations = await trackingService.getLiveLocations();
    res.json({ success: true, count: locations.length, data: locations });
  } catch (err) {
    console.error("❌ Live locations endpoint error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------
// GET /api/tracking/bus-locations
// Get latest location for all buses
// -----------------------------
router.get("/bus-locations", async (req, res) => {
  try {
    const buses = await trackingService.getBusLocations();
    res.json({ success: true, count: buses.length, data: buses });
  } catch (err) {
    console.error("❌ Bus locations endpoint error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------
// GET /api/tracking/student/:studentId
// Get last known location of a student while onboarded
// -----------------------------
router.get("/student/:studentId", async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);

    // Get the latest manifest for this student
    const manifest = await prisma.manifest.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    if (!manifest) {
      return res.status(404).json({ location: null, status: "No trip found" });
    }

    const now = new Date();

    // Only allow location if current time is between boarding and alighting
    if (!manifest.boardingTime || !manifest.alightingTime) {
      return res.json({ location: null, status: "Not onboarded yet" });
    }

    if (now < manifest.boardingTime || now > manifest.alightingTime) {
      return res.json({ location: null, status: "Out of trip window" });
    }

    // Return last known location
    return res.json({
      location: { lat: manifest.latitude, lon: manifest.longitude },
      status: "On trip",
    });
  } catch (error) {
    console.error("❌ Error fetching student tracking:", error);
    res.status(500).json({ location: null, status: "Server error" });
  }
});

export default router;
