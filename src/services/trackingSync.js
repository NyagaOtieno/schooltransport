import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOC8_API_URL = "https://myfleet.track-loc8.com/api/v1/unit.json";
const LOC8_API_KEY = "44e824d4f70647af1bb9a314b4de7e73951c8ad6";

// -----------------------------
// Sync live locations from tracker
// -----------------------------
export const syncLiveLocations = async () => {
  console.log("🚀 Starting live location sync...");

  try {
    const { data } = await axios.get(`${LOC8_API_URL}?key=${LOC8_API_KEY}`);
    const units = data?.data?.units || [];

    if (!Array.isArray(units) || units.length === 0) {
      console.warn("⚠️ No units returned from tracker API.");
      return { success: false, count: 0 };
    }

    const now = new Date();
    let updatedCount = 0;

    for (const unit of units) {
      try {
        // Validate coordinates
        if (typeof unit.lat !== "number" || typeof unit.lng !== "number" || !unit.lat || !unit.lng) {
          continue;
        }

        const lastUpdate = new Date(unit.last_update || now);

        // Normalize vehicleReg
        const vehicleReg = (unit.number || "Unknown").trim();

        // Optional: link to bus if exists
        const bus = await prisma.bus.findUnique({
          where: { plateNumber: vehicleReg },
        });
        const busId = bus?.id || null;

        const payload = {
          vehicleReg,
          busId,
          lat: parseFloat(unit.lat),
          lng: parseFloat(unit.lng),
          direction: parseFloat(unit.direction || 0),
          speed: parseFloat(unit.speed || 0),
          movementState: unit.movement_state?.name || "unknown",
          lastUpdate,
        };

        await prisma.liveLocation.upsert({
          where: { vehicleReg },
          update: payload,
          create: payload,
        });

        updatedCount++;
      } catch (err) {
        console.error(`❌ Failed to process unit ${unit.number}:`, err.message);
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
        // Match bus.plateNumber with liveLocation.vehicleReg
        const live = await prisma.liveLocation.findUnique({
          where: { vehicleReg: bus.plateNumber.trim() },
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
