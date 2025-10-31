import { notifyParent } from "../services/notification.service.js";

export async function sendNotification(req, res) {
  try {
    const { status, student, busNumber } = req.body;

    if (!status || !student || !busNumber) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: status, student, busNumber",
      });
    }

    await notifyParent(status, student, busNumber);

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
