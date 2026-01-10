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
    const { phone } = req.body; // Only phone is required
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // OTP cooldown: 60 seconds
    if (user.resetOtpSentAt) {
      const diff = Date.now() - new Date(user.resetOtpSentAt).getTime();
      if (diff < 60 * 1000) {
        return res.status(429).json({ error: "Please wait before requesting another OTP" });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtp: await bcrypt.hash(otp, 10),
        resetOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        resetOtpSentAt: new Date(),
      },
    });

    const result = await sendOtpSms({
      phone: user.phone,
      userName: user.name,
      otp,
    });

    if (!result.success) return res.status(500).json({ error: "Failed to send OTP SMS" });

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
      return res.status(400).json({
        error: "Phone, OTP, and new password are required",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and include uppercase, lowercase, and a number",
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

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        resetOtp: null,
        resetOtpExpiresAt: null,
        resetOtpSentAt: null,
      },
    });

    return res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
