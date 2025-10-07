import express from "express";
import {
  syncLiveLocations,
  getLiveLocations,
  getBusLocations,
} from "../services/trackingSync.js";

const router = express.Router();

// -----------------------------
// GET /api/tracking/sync
// Trigger manual sync from Loc8 API
// -----------------------------
router.get("/sync", async (req, res) => {
  try {
    const result = await syncLiveLocations();
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
    const locations = await getLiveLocations();
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
    const buses = await getBusLocations();
    res.json({ success: true, count: buses.length, data: buses });
  } catch (err) {
    console.error("❌ Bus locations endpoint error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
