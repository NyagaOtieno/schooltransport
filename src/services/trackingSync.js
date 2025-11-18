// src/services/trackingSync.js
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRACKING_API_URL = process.env.TRACKING_API_URL;
const TRACKING_API_KEY = process.env.TRACKING_API_KEY;

// -----------------------------
// Fetch real-time bus locations directly from tracker API
// -----------------------------
export const getBusLocations = async () => {
  try {
    // 1️⃣ Fetch all buses from DB
    const buses = await prisma.bus.findMany({
      include: { driver: true, assistant: true },
    });

    // 2️⃣ Fetch tracker data
    const { data } = await axios.get(TRACKING_API_URL, {
      headers: { "X-API-Key": TRACKING_API_KEY },
    });

    const units = Array.isArray(data) ? data : data?.data || [];

    // 3️⃣ Merge buses with tracker data
    const busLocations = buses.map((bus) => {
      // Find corresponding tracker unit
      const unit = units.find(
        (u) => u.vehicle_no?.trim() === bus.plateNumber
      );

      // Parse coordinates if valid
      const lat = unit?.last_lat != null ? parseFloat(unit.last_lat) : null;
      const lng = unit?.last_lng != null ? parseFloat(unit.last_lng) : null;

      return {
        busId: bus.id,
        plateNumber: bus.plateNumber,
        driverId: bus.driverId,
        assistantId: bus.assistantId,
        lat: lat && !isNaN(lat) ? lat : null,
        lng: lng && !isNaN(lng) ? lng : null,
        direction: unit?.direction != null ? parseFloat(unit.direction) : null,
        speed: unit?.speed != null ? parseFloat(unit.speed) : null,
        movementState: unit?.movement_state || null,
        lastUpdate: unit?.last_update ? new Date(unit.last_update) : null,
      };
    });

    return busLocations;
  } catch (err) {
    console.error("❌ Failed to fetch bus locations:", err.message);
    return [];
  }
};
