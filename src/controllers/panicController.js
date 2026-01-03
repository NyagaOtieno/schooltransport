// src/controllers/panicController.js
import { createPanicEvent } from "../services/panic.service.js";

export async function triggerPanic(req, res) {
  try {
    const userId = req.user.id;
    const phoneNumber = req.user.phone;

    const panicEvent = await createPanicEvent({
      userId,
      phoneNumber,
      role: req.user.role,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      panicId: panicEvent.id,
    });
  } catch (error) {
    console.error("PANIC ERROR:", error);
    return res.status(500).json({ success: false });
  }
}
