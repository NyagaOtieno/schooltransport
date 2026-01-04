import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { sendResetOtpEmail } from "../services/email.service.js";

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
// Send OTP
// -----------------------------
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findFirst({ where: { email } });
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtp: await bcrypt.hash(otp, 10),
        resetOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        resetOtpSentAt: new Date(),
      },
    });

    await sendResetOtpEmail(email, otp);

    return res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}

// -----------------------------
// Verify OTP & Reset Password
// -----------------------------
export async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword)
      return res.status(400).json({
        error: "Email, OTP and new password are required",
      });

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters and include uppercase, lowercase, and a number",
      });
    }

    const user = await prisma.user.findFirst({ where: { email } });

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
console.log(
  `Password reset successful for userId=${user.id} email=${user.email} at ${new Date().toISOString()}`
);

