export const syncLiveLocations = async () => {
  console.log("🚀 Starting live location sync...");

  try {
    const { data } = await axios.get(`${LOC8_API_URL}?key=${LOC8_API_KEY}`);
    const units = data?.data?.units || [];

    if (!Array.isArray(units) || units.length === 0) {
      console.warn("⚠️ No units returned from tracker API.");
      return { success: false, count: 0 };
    }

    let updatedCount = 0;

    for (const unit of units) {
      try {
        // Validate coordinates
        if (typeof unit.lat !== "number" || typeof unit.lng !== "number" || !unit.lat || !unit.lng) {
          continue;
        }

        const lastUpdate = new Date(unit.last_update || new Date());

        const payload = {
          vehicleReg: unit.number || "Unknown",
          lat: parseFloat(unit.lat),
          lng: parseFloat(unit.lng),
          direction: parseFloat(unit.direction || 0),
          speed: parseFloat(unit.speed ?? 0), // default 0 if null
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
  }
};
