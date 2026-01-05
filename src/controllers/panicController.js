// src/controllers/panicController.js
import { createPanicEvent } from "../services/panic.service.js";

export async function triggerPanic(req, res) {
  try {
    const { id, phone, role, name } = req.user || {};
    const { latitude, longitude, childId } = req.body;

    if (!id) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "Location is required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "childId is required" });
    }

    const panicEvent = await createPanicEvent({
      userId: id,               // ✅ FIXED
      phoneNumber: phone || "",
      role,
      latitude,
      longitude,
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

    // Handle known business errors cleanly
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
