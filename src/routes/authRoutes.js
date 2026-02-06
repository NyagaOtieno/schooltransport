import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../middleware/prisma.js";
import { resetPasswordLimiter } from "../middleware/rateLimit.js";
import { forgotPassword, resetPassword } from "../controllers/resetPasswordController.js";

const router = express.Router();

// -----------------------------
// Register
// -----------------------------
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password, role, schoolId } = req.body;

    // Validation
    if (!name || !email || !password || !role || !schoolId) {
      return res.status(400).json({ error: "All required fields must be provided" });
    }

    // Check if email or phone already exists within the same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId: Number(schoolId),
        OR: [{ email }, ...(phone ? [{ phone }] : [])],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Email or phone already exists for this school. You can only update the existing user.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role, schoolId: Number(schoolId) },
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
});

// -----------------------------
// Login
// -----------------------------
router.post("/login", async (req, res) => {
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

    // Generate JWT
  const token = jwt.sign(
  {
    userId: user.id,
    role: user.role,
    schoolId: user.schoolId, // ✅ ADD THIS
  },
  process.env.JWT_SECRET,
  { expiresIn: "1d" }
);


    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
      instructions: "Use this token as Bearer token in Postman Authorization header",
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// Forgot Password
// -----------------------------
router.post("/forgot-password", resetPasswordLimiter, forgotPassword);

// -----------------------------
// Reset Password
// -----------------------------
router.post("/reset-password", resetPasswordLimiter, resetPassword);

export default router;
