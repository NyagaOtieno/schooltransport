// src/controllers/panicController.js
import { createPanicEvent } from "../services/panic.service.js";

export async function triggerPanic(req, res) {
  try {
    const { id, phone, role, name } = req.user || {};
    const { latitude, longitude, childId } = req.body;

    if (!id) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    const lat = typeof latitude === "string" ? Number(latitude) : latitude;
    const lng = typeof longitude === "string" ? Number(longitude) : longitude;

    if (lat === null || lat === undefined || Number.isNaN(lat) || lng === null || lng === undefined || Number.isNaN(lng)) {
      return res.status(400).json({ error: "Location is required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "childId is required" });
    }

    const panicEvent = await createPanicEvent({
      userId: id,
      phoneNumber: phone || "",
      role,
      latitude: lat,
      longitude: lng,
      childId,
      createdBy: name || "Unknown",
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.status(201).json({
      success: true,
      panicId: panicEvent.id,
      status: panicEvent.status,
      triggeredAt: panicEvent.createdAt,
      cooldown: 60,
    });
  } catch (error) {
    console.error("PANIC ERROR:", error.message);

    if (error.message === "Panic cooldown active") {
      return res.status(429).json({
        success: false,
        error: "Panic already triggered recently. Please wait.",
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
