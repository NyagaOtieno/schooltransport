// src/controllers/panicController.js
import { createPanicEvent } from "../services/panic.service.js";

export async function triggerPanic(req, res) {
  try {
    const userId = req.user.id;
    const phoneNumber = req.user.phone;
    const role = req.user.role;

    const { latitude, longitude, childId } = req.body;

    // 🔐 Validation
    if (!latitude || !longitude) {
      return res.status(400).json({ error: "Location is required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "childId is required" });
    }

    // 🚨 Create panic event
   const panicEvent = await createPanicEvent({
  userId,
  childId,
  phoneNumber,
  role,
  latitude,
  longitude,
  createdBy: req.user.role, 
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
});


    // ✅ Frontend-friendly response
    return res.status(200).json({
      success: true,
      panicId: panicEvent.id,
      status: panicEvent.status || "ACTIVE",
      triggeredAt: panicEvent.createdAt,
      cooldown: 60,
    });

  } catch (error) {
    console.error("PANIC ERROR:", error);

    if (error.message?.includes("cooldown")) {
      return res.status(429).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({ success: false });
  }
}
