import prisma from "../middleware/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { sendResetOtpEmail } from "../services/email.service.js";

// -----------------------------
// Password strength checker
// -----------------------------
function isStrongPassword(password) {
  return (
    password &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

// -----------------------------
// Allowed roles
// -----------------------------
const ALLOWED_ROLES = [
  "ADMIN",
  "DRIVER",
  "ASSISTANT",
  "PARENT",
  "CLIENT",
  "MERCHANT",
  "AGENT",
  "SYSTEM_ADMIN",
];

// -----------------------------
// Resolve tenantId safely
// -----------------------------
function resolveTenantId(body) {
  const tenantId = body?.tenantId ?? body?.TenantId ?? body?.schoolId;
  if (!tenantId) return null;

  const parsed = Number(tenantId);
  return Number.isFinite(parsed) ? parsed : null;
}

// -----------------------------
// JWT token generator (CLEAN)
// -----------------------------
function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: String(user.role).toUpperCase(),
      tenantId: user.tenantId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// =============================
// REGISTER USER
// =============================
export const register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const role = req.body.role ? String(req.body.role).toUpperCase() : null;

    const tenantId = resolveTenantId(req.body);

    const platformRoles = ["AGENT", "SYSTEM_ADMIN"];

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "name, email, password, role are required",
      });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}`,
      });
    }

    // Block system admin creation
    if (role === "SYSTEM_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "SYSTEM_ADMIN must be created via bootstrap",
      });
    }

    // Block agent self-register
    if (role === "AGENT") {
      return res.status(403).json({
        success: false,
        message: "AGENT must be created by system admin",
      });
    }

    // Tenant required for non-platform users
    if (!platformRoles.includes(role) && !tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenantId is required for this role",
      });
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        return res.status(400).json({
          success: false,
          message: "Tenant does not exist",
        });
      }
    }

    // Check duplicates
    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId: tenantId ?? null,
        OR: [
          { email },
          ...(phone ? [{ phone }] : []),
        ],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists in this tenant",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashedPassword,
        role,
        tenantId: platformRoles.includes(role) ? null : tenantId,
      },
    });

    const token = signToken(user);

    const { password: _, ...safeUser } = user;

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// =============================
// LOGIN USER
// =============================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const tenantId = resolveTenantId(req.body);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    let user = null;

    if (tenantId) {
      user = await prisma.user.findFirst({
        where: { email, tenantId },
      });
    } else {
      const matches = await prisma.user.findMany({
        where: { email },
        take: 2,
      });

      if (matches.length > 1) {
        return res.status(409).json({
          success: false,
          message: "Multiple tenants found. Provide tenantId.",
        });
      }

      user = matches[0] || null;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = signToken(user);
    const { password: _, ...safeUser } = user;

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// =============================
// FORGOT PASSWORD
// =============================
export const forgotPassword = async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: "Email or phone required",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
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

    if (!user.email) {
      return res.status(400).json({
        success: false,
        message: "No email found for OTP delivery",
      });
    }

    await sendResetOtpEmail(user.email, otp);

    return res.json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("FORGOT PASSWORD ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// =============================
// RESET PASSWORD
// =============================
export const resetPassword = async (req, res) => {
  try {
    const { email, phone, otp, newPassword } = req.body;

    if ((!email && !phone) || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be 8+ chars, uppercase, lowercase, number",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
    });

    if (!user || !user.resetOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset request",
      });
    }

    if (user.resetOtpExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    const validOtp = await bcrypt.compare(otp, user.resetOtp);

    if (!validOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        resetOtp: null,
        resetOtpExpiresAt: null,
        resetOtpSentAt: null,
      },
    });

    return res.json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};