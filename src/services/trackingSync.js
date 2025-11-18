// src/services/trackingSync.js
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRACKING_API_URL = process.env.TRACKING_API_URL;
const TRACKING_API_KEY = process.env.TRACKING_API_KEY;

// -----------------------------
// Sync live locations from tracker
// -----------------------------
export const syncLiveLocations = async () => {
  console.log("🚀 Starting live location sync...");

  try {
    // ✅ Call external tracking API with headers
    const { data } = await axios.get(TRACKING_API_URL, {
      headers: { "X-API-Key": TRACKING_API_KEY },
    });

    // Ensure we have an array of units
    const units = Array.isArray(data) ? data : data?.data || [];

    if (units.length === 0) {
      console.warn("⚠️ No units returned from tracker API.");
      return { success: false, count: 0 };
    }

    const now = new Date();
    let updatedCount = 0;

    for (const unit of units) {
      try {
        const lat = parseFloat(unit.last_lat);
        const lng = parseFloat(unit.last_lng);

        // Skip invalid coordinates
        if (!lat || !lng) continue;

        const lastUpdate = new Date(unit.last_update || now);

        // Normalize vehicleReg from tracker
        const vehicleReg = (unit.vehicle_no || "Unknown").trim();

        // Link to bus if exists
        const bus = await prisma.bus.findFirst({
          where: { plateNumber: vehicleReg },
        });

        const payload = {
          vehicleReg,
          busId: bus?.id ?? null,
          lat,
          lng,
          direction: parseFloat(unit.direction || 0),
          speed: parseFloat(unit.speed || 0),
          movementState: unit.movement_state || "unknown",
          lastUpdate,
        };

        // Upsert live location
        await prisma.liveLocation.upsert({
          where: { vehicleReg },
          update: payload,
          create: payload,
        });

        updatedCount++;
      } catch (err) {
        console.error(`❌ Failed to process unit ${unit.vehicle_no}:`, err.message);
      }
    }

    console.log(`✅ Synced ${updatedCount} live locations`);
    return { success: true, count: updatedCount };
  } catch (error) {
    console.error("❌ Error syncing live locations:", error.message);
    return { success: false, error: error.message };
  }
};

// -----------------------------
// Get all live student locations
// -----------------------------
export const getLiveLocations = async () => {
  try {
    return await prisma.liveLocation.findMany({
      orderBy: { lastUpdate: "desc" },
    });
  } catch (err) {
    console.error("❌ Failed to fetch live locations:", err.message);
    return [];
  }
};

// -----------------------------
// Get all bus locations
// -----------------------------
export const getBusLocations = async () => {
  try {
    const buses = await prisma.bus.findMany({
      include: { driver: true, assistant: true },
    });

    const busLocations = await Promise.all(
      buses.map(async (bus) => {
        const live = await prisma.liveLocation.findFirst({
          where: { busId: bus.id },
          orderBy: { lastUpdate: "desc" },
        });

        return {
          busId: bus.id,
          plateNumber: bus.plateNumber,
          driverId: bus.driverId,
          assistantId: bus.assistantId,
          lat: live?.lat ?? null,
          lng: live?.lng ?? null,
          direction: live?.direction ?? null,
          speed: live?.speed ?? null,
          movementState: live?.movementState ?? null,
          lastUpdate: live?.lastUpdate ?? null,
        };
      })
    );

    return busLocations;
  } catch (err) {
    console.error("❌ Failed to fetch bus locations:", err.message);
    return [];
  }
};
