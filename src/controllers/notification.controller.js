import { notifyParent } from "../services/notification.service.js";

/**
 * REQUIRED EXPORT — DO NOT RENAME
 */
export default async function sendNotification(req, res) {
  try {
    const {
      parentName = "Parent",
      parentPhone,
      studentName,
      eventType,
      busNumber = null,
      session = null,
    } = req.body;

    // Validate required fields
    if (!parentPhone || !studentName || !eventType) {
      return res.status(400).json({
        success: false,
        error: "parentPhone, studentName, and eventType are required",
      });
    }

    // Send notification
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

    return res.status(200).json({
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
