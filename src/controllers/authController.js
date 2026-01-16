import prisma from "../middleware/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { sendResetOtpEmail } from "../services/email.service.js";


// -----------------------------
// Password strength checker
// -----------------------------
function isStrongPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

// -----------------------------
// Register user
// -----------------------------
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, role, schoolId } = req.body;

    if (!name || !email || !password || !role || !schoolId) {
      return res.status(400).json({ error: "All required fields must be provided" });
    }

    // Check for existing user in same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [{ email }, { phone }],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Email or phone already exists for this school",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role, schoolId },
    });

    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      message: "User registered successfully",
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Login user
// -----------------------------
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Support multiple schools: findFirst
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
      instructions: "Use this token as Bearer token in Authorization header",
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Forgot Password (Send OTP)
// -----------------------------
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // OTP resend cooldown: 60s
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

    await sendResetOtpEmail(email, otp);

    res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Reset Password (Verify OTP)
// -----------------------------
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "Email, OTP, and new password are required" });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and include uppercase, lowercase, and a number",
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

    console.log(
      `Password reset successful for userId=${user.id} email=${user.email} at ${new Date().toISOString()}`
    );

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
};
