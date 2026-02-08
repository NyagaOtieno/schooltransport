// src/routes/authRoutes.js
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

const normEmail = (v) => (v ? String(v).trim().toLowerCase() : null);
const normPhone = (v) => (v ? String(v).trim() : null);
const toUpper = (v) => (v ? String(v).trim().toUpperCase() : null);

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Backward compatible: accept tenantId OR TenantId OR schoolId
 * (Do NOT store TenantId anywhere; only use tenantId in DB)
 */
function resolveTenantId(body) {
  const raw = body?.tenantId ?? body?.TenantId ?? body?.schoolId;
  if (raw === undefined || raw === null || raw === "") return null;
  return toInt(raw);
}

function signToken(user) {
  const tenantId = user?.tenantId ?? null;

  return jwt.sign(
    {
      userId: user.id,
      role: toUpper(user.role),
      tenantId: tenantId !== null ? Number(tenantId) : null,

      // backward compatibility for old clients
      schoolId: tenantId !== null ? Number(tenantId) : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
}

function prismaFail(res, err, fallback = "Server error") {
  console.error("❌ AUTH ERROR:", {
    code: err?.code,
    message: err?.message,
    meta: err?.meta,
  });

  if (err?.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "Duplicate conflict",
      fields: err?.meta?.target,
    });
  }

  return res.status(500).json({
    success: false,
    message: fallback,
    detail: process.env.NODE_ENV === "production" ? undefined : err?.message,
  });
}

/* =========================
   Register
========================= */
router.post("/register", async (req, res) => {
  try {
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const email = normEmail(req.body?.email);
    const phone = normPhone(req.body?.phone);
    const password = req.body?.password ? String(req.body.password) : null;
    const role = toUpper(req.body?.role);
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
        message: Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")},
      });
    }

    // Ensure tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return res.status(400).json({ success: false, message: "Tenant does not exist" });
    }

    // Check if email/phone already exists within same tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId,
        OR: [{ email }, ...(phone ? [{ phone }] : [])],
      },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already exists for this tenant. Update the existing user instead.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role,
        tenantId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const token = signToken(user);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user,
    });
  } catch (err) {
    return prismaFail(res, err, "Failed to register user");
  }
});

/* =========================
   Login
========================= */
router.post("/login", async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = req.body?.password ? String(req.body.password) : null;
    const tenantId = resolveTenantId(req.body);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    let user = null;

    if (tenantId) {
      // ✅ Correct scoping (best practice)
      user = await prisma.user.findFirst({
        where: { email, tenantId },
      });
    } else {
      // If tenantId isn't provided, email could exist in multiple tenants.
      const matches = await prisma.user.findMany({
        where: { email },
        select: { id: true, tenantId: true },
        take: 2, // just to detect multiple
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

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = signToken(user);

    // Don’t leak password
    const { password: _pw, ...safeUser } = user;

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser,
    });
  } catch (err) {
    return prismaFail(res, err, "Failed to login");
  }
});

/* =========================
   Forgot / Reset Password
========================= */
router.post("/forgot-password", resetPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);

export default router;