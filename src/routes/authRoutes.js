import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../middleware/prisma.js";
import { resetPasswordLimiter } from "../middleware/rateLimit.js";
import { forgotPassword, resetPassword } from "../controllers/resetPasswordController.js";

const router = express.Router();

/* =========================
   Helpers
   ========================= */

const ALLOWED_ROLES = ["ADMIN", "DRIVER", "ASSISTANT", "PARENT", "CLIENT", "MERCHANT"];

function toUpper(v) {
  return v ? String(v).trim().toUpperCase() : null;
}

function resolveTenantId(body) {
  // Backward compatible: accept tenantId OR TenantId OR schoolId
  const raw = body.tenantId ?? body.TenantId ?? body.schoolId;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function signToken(user) {
  const tenantId = user.TenantId ?? user.tenantId ?? user.schoolId ?? null;

  return jwt.sign(
    {
      userId: user.id,
      role: toUpper(user.role),
      tenantId: tenantId !== null && tenantId !== undefined ? Number(tenantId) : null,

      // backward compatibility for old clients
      schoolId: tenantId !== null && tenantId !== undefined ? Number(tenantId) : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
}

/* =========================
   Register
   ========================= */
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const role = toUpper(req.body.role);
    const tenantId = resolveTenantId(req.body);

    // Validation
    if (!name || !email || !password || !role || !tenantId) {
      return res.status(400).json({
        success: false,
        message: "name, email, password, role, and tenantId are required",
      });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}`,
      });
    }

    // Ensure tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: Number(tenantId) } });
    if (!tenant) {
      return res.status(400).json({ success: false, message: "Tenant does not exist" });
    }

    // Check if email or phone already exists within the same tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        TenantId: Number(tenantId),
        OR: [
          { email },
          ...(phone ? [{ phone }] : []),
        ],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already exists for this tenant. Update the existing user instead.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: String(email).trim(),
        phone: phone ? String(phone).trim() : null,
        password: hashedPassword,
        role,
        TenantId: Number(tenantId),
      },
    });

    const token = signToken(user);
    const { password: _pw, ...userWithoutPassword } = user;

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   Login
   ========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const tenantId = resolveTenantId(req.body);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // If tenantId is provided, scope login properly (best practice)
    let user = null;

    if (tenantId) {
      user = await prisma.user.findFirst({
        where: { email: String(email).trim(), TenantId: Number(tenantId) },
      });
    } else {
      // Without tenantId, email may exist in multiple tenants -> block & ask for tenantId
      const matches = await prisma.user.findMany({
        where: { email: String(email).trim() },
        select: { id: true, TenantId: true },
      });

      if (matches.length > 1) {
        return res.status(409).json({
          success: false,
          message: "This email exists in multiple tenants. Provide tenantId to login.",
        });
      }

      if (matches.length === 1) {
        user = await prisma.user.findUnique({ where: { id: matches[0].id } });
      }
    }

    if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = signToken(user);
    const { password: _pw, ...userWithoutPassword } = user;

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   Forgot / Reset Password
   ========================= */
router.post("/forgot-password", resetPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);

export default router;
