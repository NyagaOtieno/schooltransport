import express from "express";
import { syncLiveLocations } from "../services/trackingSync.js";

const router = express.Router();

// Trigger manual sync
router.get("/sync", async (req, res) => {
  const result = await syncLiveLocations();
  res.json(result);
});

export default router;
