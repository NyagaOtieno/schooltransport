// src/controllers/trackingController.js
import prisma from "../middleware/prisma.js";
import axios from "axios";

/**
 * 1️⃣ Save or update live GPS data for a bus
 * Called either by a cron job or webhook
 */
export const saveLiveLocation = async (req, res) => {
  try {
    const { unit_id, lat, lng, direction, speed, state, movement_state, last_update, box_id } = req.body;

    if (!unit_id || !lat || !lng) {
      return res.status(400).json({ message: "Missing required GPS fields" });
    }

    // Find the bus mapped to this device
    const bus = await prisma.bus.findFirst({
      where: { id: unit_id }, // Adjust if your bus model maps differently (maybe box_id)
    });

    if (!bus) {
      return res.status(404).json({ message: "Bus not found for this device" });
    }

    // Check last saved entry for same bus
    const lastLocation = await prisma.busLocation.findFirst({
      where: { busId: bus.id },
      orderBy: { createdAt: "desc" },
    });

    // If last location is less than 6 seconds ago, update it instead of inserting
    const now = new Date();
    if (lastLocation) {
      const diff = (now - new Date(lastLocation.createdAt)) / 1000;
      if (diff < 6) {
        const updated = await prisma.busLocation.update({
          where: { id: lastLocation.id },
          data: {
            lat,
            lng,
            direction,
            speed,
            state: state?.name || null,
            movement: movement_state?.name || null,
            lastUpdate: new Date(last_update),
            updatedAt: now,
          },
        });
        return res.status(200).json({ message: "Updated recent bus location", data: updated });
      }
    }

    // Otherwise, create new record
    const newLocation = await prisma.busLocation.create({
      data: {
        busId: bus.id,
        deviceId: box_id || 0,
        lat,
        lng,
        direction,
        speed,
        state: state?.name || null,
        movement: movement_state?.name || null,
        lastUpdate: new Date(last_update),
      },
    });

    res.status(201).json({ message: "New bus location saved", data: newLocation });
  } catch (error) {
    console.error("Error saving live location:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * 2️⃣ Get latest location for a bus
 */
export const getLatestLocation = async (req, res) => {
  try {
    const { busId } = req.params;

    const location = await prisma.busLocation.findFirst({
      where: { busId: Number(busId) },
      orderBy: { createdAt: "desc" },
    });

    if (!location) {
      return res.status(404).json({ message: "No location found for this bus" });
    }

    res.status(200).json(location);
  } catch (error) {
    console.error("Error fetching latest location:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
