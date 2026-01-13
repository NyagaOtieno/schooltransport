import { notifyParent } from "../services/notification.service.js";

/**
 * Send notification controller
 */
export async function sendNotification(req, res) {
  try {
    const {
      parentName,
      parentPhone,
      studentName,
      eventType,
      busNumber,
      session,
    } = req.body;

    if (!parentPhone || !studentName || !eventType) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const result = await notifyParent({
      parentName,
      parentPhone,
      studentName,
      eventType,
      busNumber,
      session,
    });

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json({
      success: true,
      message: "Notification sent successfully",
    });
  } catch (err) {
    console.error("❌ sendNotification error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
}
