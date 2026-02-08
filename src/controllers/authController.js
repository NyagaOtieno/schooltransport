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

// ✅ Allow these roles
const ALLOWED_ROLES = ["ADMIN", "DRIVER", "ASSISTANT", "PARENT", "CLIENT", "MERCHANT"];

// ✅ Resolve tenantId from incoming body (backward compatible with schoolId)
function resolveTenantId(body) {
  const tenantId = body.tenantId ?? body.TenantId ?? body.schoolId;
  return tenantId !== undefined && tenantId !== null && tenantId !== "" ? Number(tenantId) : null;
}

// ✅ Create JWT payload consistently
function signToken(user) {
  const tenantId =
    user.TenantId ?? user.tenantId ?? user.schoolId ?? null; // backward compatibility

  return jwt.sign(
    {
      userId: user.id,
      role: String(user.role).toUpperCase(),
      tenantId: tenantId !== null && tenantId !== undefined ? Number(tenantId) : null,

      // optional backward compatibility
      schoolId: tenantId !== null && tenantId !== undefined ? Number(tenantId) : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// -----------------------------
// Register user
// -----------------------------
export const register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const roleRaw = req.body.role;
    const role = roleRaw ? String(roleRaw).toUpperCase() : null;

    // ✅ tenantId replaces schoolId (but we accept schoolId as fallback)
    const tenantId = resolveTenantId(req.body);

    if (!name || !email || !password || !role || !tenantId) {
      return res.status(400).json({
        error: "name, email, password, role, and tenantId are required",
      });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}`,
      });
    }

    // ✅ Confirm tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: Number(tenantId) } });
    if (!tenant) {
      return res.status(400).json({ error: "Tenant does not exist" });
    }

    // ✅ Check for existing user in same tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        TenantId: Number(tenantId), // 👈 matches your schema
        OR: [{ email }, ...(phone ? [{ phone }] : [])],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Email or phone already exists for this tenant",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashedPassword,
        role,
        TenantId: Number(tenantId),
      },
    });

    const token = signToken(user);
    const { password: _, ...userWithoutPassword } = user;

    return res.status(201).json({
      message: "User registered successfully",
      token,
      user: userWithoutPassword,
      instructions: "Use this token as Bearer token in Authorization header",
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Login user
// -----------------------------
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Optional: allow tenantId for unambiguous login (recommended)
    const tenantId = resolveTenantId(req.body);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // ✅ If tenantId is provided, login is scoped properly
    // ✅ If not provided, we attempt findFirst by email; if multiple tenants share same email -> error
    let user = null;

    if (tenantId) {
      user = await prisma.user.findFirst({
        where: { email, TenantId: Number(tenantId) },
      });
    } else {
      const matches = await prisma.user.findMany({
        where: { email },
        select: { id: true, TenantId: true, password: true, role: true, name: true, email: true, phone: true },
      });

      if (matches.length > 1) {
        return res.status(409).json({
          error: "This email exists in multiple tenants. Provide tenantId to login.",
        });
      }

      user = matches[0] || null;
      // If we selected limited fields above, fetch full user
      if (user?.id) {
        user = await prisma.user.findUnique({ where: { id: user.id } });
      }
    }

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user);
    const { password: _, ...userWithoutPassword } = user;

    return res.json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
      instructions: "Use this token as Bearer token in Authorization header",
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Forgot Password (Send OTP)
// ✅ Supports email OR phone (your frontend uses phone)
// -----------------------------
export const forgotPassword = async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone) return res.status(400).json({ error: "Email or phone is required" });

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
    });

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

    // ✅ You currently send OTP via email service
    // If phone-only users exist, you should also add an SMS sender here.
    if (!user.email) {
      return res.status(400).json({
        error: "This account has no email. Add SMS OTP sending or store email for this user.",
      });
    }

    await sendResetOtpEmail(user.email, otp);
    return res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// -----------------------------
// Reset Password (Verify OTP)
// ✅ Supports email OR phone
// -----------------------------
export const resetPassword = async (req, res) => {
  try {
    const { email, phone, otp, newPassword } = req.body;

    if ((!email && !phone) || !otp || !newPassword) {
      return res.status(400).json({ error: "email/phone, OTP, and newPassword are required" });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and include uppercase, lowercase, and a number",
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
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
