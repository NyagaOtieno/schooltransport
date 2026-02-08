// src/routes/smsRoutes.js
import express from "express";
import { sendSms } from "../utils/smsGateway.js";
import { authMiddleware } from "../middleware/auth.js"; // optional

const router = express.Router();

/**
 * POST /api/sms/send
 * Body: { phone: string, message: string }
 */

// 🔒 OPTIONAL: uncomment if you want to restrict SMS sending
// router.use(authMiddleware);

router.post("/send", async (req, res) => {
  try {
    const { phone, message } = req.body;

    // -----------------------------
    // Validation
    // -----------------------------
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid phone number is required",
      });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Message is too long (max 500 characters)",
      });
    }

    // Normalize phone (basic)
    const normalizedPhone = phone.trim();

    // -----------------------------
    // Send SMS
    // -----------------------------
    const result = await sendSms(normalizedPhone, message.trim());

    return res.status(200).json({
      success: true,
      message: "SMS sent successfully",
      data: result,
    });
  } catch (error) {
    console.error("❌ SMS send error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send SMS",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;
