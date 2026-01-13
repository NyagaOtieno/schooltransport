// src/controllers/notification.controller.js
import { notifyParent } from "../services/notification.service.js";

/**
 * Send notification to a parent about a student's status on the bus
 * Expects body:
 * {
 *   "status": "checked_in" | "checked_out",
 *   "student": {
 *     "name": "John Doe",
 *     "parentName": "Jane Doe",
 *     "parentPhone": "0722301062"
 *   },
 *   "busNumber": "KBY 123X",
 *   "session": "Morning"
 * }
 */
export async function sendNotification(req, res) {
  try {
    const { status, student, busNumber, session } = req.body;

    // Validate request body
    if (!status || !student || !student.name || !student.parentName || !student.parentPhone || !busNumber) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: status, student (with name, parentName, parentPhone), busNumber",
      });
    }

    // Send notification
    const result = await notifyParent({
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      studentName: student.name,
      eventType: status,
      busNumber,
      session: session || "N/A", // default if session is not provided
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send notification",
        error: result.error || "Unknown error from SMS gateway",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification sent successfully",
    });
  } catch (error) {
    console.error("❌ Error sending notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error.message,
    });
  }
}
