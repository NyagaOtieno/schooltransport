import axios from "axios";

const BASE_URL =
  process.env.MANIFEST_API_URL ||
  "https://schooltransport-production.up.railway.app/api/manifests";

/**
 * Fetch a manifest by ID
 */
export async function getManifestById(manifestId) {
  try {
    const response = await axios.get(`${BASE_URL}/${manifestId}`);
    console.log(`✅ Manifest ${manifestId} fetched successfully`);
    return response.data;
  } catch (error) {
    console.error("❌ Failed to fetch manifest:", error.message);
    throw new Error("Manifest not found or server error");
  }
}

/**
 * Fetch all manifests
 */
export async function getAllManifests() {
  try {
    const response = await axios.get(BASE_URL);
    console.log("✅ All manifests fetched successfully");
    return response.data;
  } catch (error) {
    console.error("❌ Failed to fetch manifests:", error.message);
    throw new Error("Unable to fetch manifests");
  }
}

/**
 * Update manifest status (e.g., onboard/offboard)
 */
export async function updateManifestStatus(manifestId, status) {
  try {
    const response = await axios.put(`${BASE_URL}/${manifestId}`, { status });
    console.log(`✅ Manifest ${manifestId} updated to status: ${status}`);
    return response.data;
  } catch (error) {
    console.error("❌ Manifest update failed:", error.message);
    throw new Error("Failed to update manifest status");
  }
}

/**
 * Helper — Simulate manifest update if no backend write access
 */
export async function simulateUpdate(manifestId, status) {
  console.log(`🔧 Simulating manifest update for ${manifestId} → ${status}`);
  return { id: manifestId, status, updatedAt: new Date().toISOString() };
}
