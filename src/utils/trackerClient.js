import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Tracker API client
 * This handles communication with the external GPS tracking provider.
 */

const TRACKER_API_KEY = process.env.TRACKER_API_KEY || "44e824d4f70647af1bb9a314b4de7e73951c8ad6";
const TRACKER_BASE_URL = "https://myfleet.track-loc8.com/api/v1";

/**
 * Fetch all live unit data (vehicles) from the tracker API.
 * Returns an array of unit objects, or throws on failure.
 */
export async function fetchAllUnits() {
  try {
    const url = `${TRACKER_BASE_URL}/unit.json?key=${TRACKER_API_KEY}`;
    const response = await axios.get(url);

    if (!response.data || !response.data.data || !response.data.data.units) {
      console.warn("⚠️ Unexpected tracker response format:", response.data);
      return [];
    }

    return response.data.data.units.map((unit) => ({
      vehicleReg: unit.number || unit.label || "UNKNOWN",
      lat: unit.lat,
      lng: unit.lng,
      direction: unit.direction || 0,
      speed: unit.speed || 0,
      movementState: unit.movement_state?.name || unit.state?.name || "unknown",
      lastUpdate: unit.last_update,
      deviceId: unit.unit_id,
    }));
  } catch (error) {
    console.error("❌ Error fetching tracker data:", error.message);
    return [];
  }
}
