import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRACKING_API_URL = process.env.TRACKING_API_URL;
const TRACKING_API_KEY = process.env.TRACKING_API_KEY;

// -----------------------------
// Fetch real-time bus locations directly from tracker API
// Safe parsing for all fields
// -----------------------------
export const getBusLocations = async () => {
  try {
    // 1️⃣ Fetch all buses from DB (with driver and assistant)
    const buses = await prisma.bus.findMany({
      include: { driver: true, assistant: true },
    });

    // 2️⃣ Fetch tracker data
    const { data } = await axios.get(TRACKING_API_URL, {
      headers: { "X-API-Key": TRACKING_API_KEY },
    });

    const units = Array.isArray(data) ? data : data?.data || [];

    // 3️⃣ Merge buses with tracker data safely
    const busLocations = buses.map((bus) => {
      // Find corresponding tracker unit by plate number
      const unit = units.find(
        (u) => u.vehicle_no?.trim() === bus.plateNumber
      );

      // Parse coordinates safely
      const lat = unit?.last_lat != null ? Number(unit.last_lat) : null;
      const lng = unit?.last_lng != null ? Number(unit.last_lng) : null;

      return {
        busId: bus.id,
        plateNumber: bus.plateNumber ?? "Unknown",
        driverId: bus.driverId ?? null,
        assistantId: bus.assistantId ?? null,
        lat: lat != null && !isNaN(lat) ? lat : null,
        lng: lng != null && !isNaN(lng) ? lng : null,
        direction: unit?.direction != null && !isNaN(unit.direction)
          ? Number(unit.direction)
          : 0,
        speed: unit?.speed != null && !isNaN(unit.speed)
          ? Number(unit.speed)
          : 0,
        movementState: unit?.movement_state || "unknown",
        lastUpdate: unit?.last_update
          ? new Date(unit.last_update)
          : new Date(),
      };
    });

    return busLocations;
  } catch (err) {
    console.error("❌ Failed to fetch bus locations:", err.message);
    return [];
  }
};
