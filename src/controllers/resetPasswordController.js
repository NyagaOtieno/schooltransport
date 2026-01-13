

// src/controllers/resetPassword.controller.js
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { sendOtpSms } from "../services/notification.service.js";

// Password strength checker
function isStrongPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

// -----------------------------
// Send OTP via SMS
export async function forgotPassword(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    // Find user by phone
    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // OTP resend cooldown: 60 seconds
    if (user.resetOtpSentAt) {
      const diff = Date.now() - new Date(user.resetOtpSentAt).getTime();
      if (diff < 60 * 1000) {
        return res.status(429).json({
          error: "Please wait before requesting another OTP",
        });
      }
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP hash and expiry in DB
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtp: await bcrypt.hash(otp, 10),
        resetOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        resetOtpSentAt: new Date(),
      },
    });

    // Send OTP via SMS
    const result = await sendOtpSms({
      phone: user.phone,
      userName: user.name,
      otp,
    });

    if (!result.success) {
      console.error("❌ OTP SMS failed:", result);
      return res.status(500).json({ error: "Failed to send OTP SMS" });
    }

    console.log(`✅ OTP sent successfully to ${user.phone}`);
    return res.json({ success: true, message: "OTP sent via SMS" });
  } catch (err) {
    console.error("❌ forgotPassword() crashed:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// -----------------------------
// Verify OTP & Reset Password
export async function resetPassword(req, res) {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({
        error: "Phone, OTP and new password are required",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters and include uppercase, lowercase, and a number",
      });
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user || !user.resetOtp || !user.resetOtpExpiresAt) {
      return res.status(400).json({ error: "Invalid reset request" });
    }

    if (user.resetOtpExpiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    const validOtp = await bcrypt.compare(otp, user.resetOtp);
    if (!validOtp) return res.status(400).json({ error: "Invalid OTP" });

    // Update password and clear OTP fields
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        resetOtp: null,
        resetOtpExpiresAt: null,
        resetOtpSentAt: null,
      },
    });

    console.log(
      `✅ Password reset successful for userId=${user.id} phone=${user.phone} at ${new Date().toISOString()}`
    );

    return res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("❌ resetPassword() crashed:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
