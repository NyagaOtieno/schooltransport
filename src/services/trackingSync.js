import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOC8_API_URL = "https://myfleet.track-loc8.com/api/v1/unit.json";
const LOC8_API_KEY = "44e824d4f70647af1bb9a314b4de7e73951c8ad6";

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
        if (
          typeof unit.lat !== "number" ||
          typeof unit.lng !== "number" ||
          !unit.lat ||
          !unit.lng
        ) {
          continue;
        }

        const lastUpdate = new Date(unit.last_update || now);
        const diffSeconds = (now - lastUpdate) / 1000;

        // Ignore stale data (>6 seconds old)
        if (diffSeconds > 6) continue;

        const payload = {
          vehicleReg: unit.number || "Unknown",
          lat: parseFloat(unit.lat),
          lng: parseFloat(unit.lng),
          direction: parseFloat(unit.direction || 0),
          speed: parseFloat(unit.speed || 0),
          movementState: unit.movement_state?.name || "unknown",
          lastUpdate,
        };

        await prisma.liveLocation.upsert({
          where: { vehicleReg: payload.vehicleReg },
          update: {
            lat: payload.lat,
            lng: payload.lng,
            direction: payload.direction,
            speed: payload.speed,
            movementState: payload.movementState,
            lastUpdate: payload.lastUpdate,
          },
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
  } finally {
    await prisma.$disconnect();
  }
};
