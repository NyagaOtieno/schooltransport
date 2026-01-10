import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { sendSms } from "../utils/smsGateway.js"; // your existing SMS sender

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
    if (!phone) return res.status(400).json({ error: "Phone is required" });

    // Find user by phone
    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // OTP resend cooldown
    if (user.resetOtpSentAt) {
      const diff = Date.now() - new Date(user.resetOtpSentAt).getTime();
      if (diff < 60 * 1000) {
        return res.status(429).json({
          error: "Please wait before requesting another OTP",
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtp: otp, // you can hash it if needed
        resetOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        resetOtpSentAt: new Date(),
      },
    });

    // Send OTP via SMS
    const { sendSms } = await import("../utils/smsGateway.js");
    await sendSms(phone, `Your OTP for password reset is: ${otp}`);

    return res.json({ success: true, message: "OTP sent via SMS" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}



// -----------------------------
// Verify OTP & Reset Password
export async function resetPassword(req, res) {
  try {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ error: "Phone, OTP and new password are required" });
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user || !user.resetOtp || !user.resetOtpExpiresAt) {
      return res.status(400).json({ error: "Invalid reset request" });
    }

    if (user.resetOtpExpiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    if (user.resetOtp !== otp) return res.status(400).json({ error: "Invalid OTP" });

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 10), resetOtp: null, resetOtpExpiresAt: null, resetOtpSentAt: null },
    });

    return res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
