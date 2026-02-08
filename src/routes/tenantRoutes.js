// src/routes/tenantRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

function prismaError(res, err, fallback = "Server error") {
  console.error("❌ TenantRoutes error:", { code: err?.code, message: err?.message, meta: err?.meta });

  if (err?.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "Duplicate conflict",
      fields: err?.meta?.target,
    });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  return res.status(500).json({
    success: false,
    message: fallback,
    detail: process.env.NODE_ENV === "production" ? undefined : err?.message,
  });
}

function requireTenant(req, res, next) {
  const tenantId = toInt(req.user?.tenantId);
  if (!tenantId) {
    return res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
  }
  req.tenantId = tenantId;
  next();
}

const tenantSelect = {
  id: true,
  name: true,
  mode: true,
  logoUrl: true,
  address: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
};

/* =========================
   PUBLIC: Bootstrap tenant + admin
   POST /api/tenants/bootstrap
========================= */
/**
 * Body example:
 * {
 *   "tenantName": "Demo School",
 *   "mode": "KID",
 *   "adminName": "System Admin",
 *   "email": "admin@demo.com",
 *   "phone": "0700xxxxxx",
 *   "password": "changeme"
 * }
 */
router.post("/bootstrap", async (req, res) => {
  try {
    const tenantName = toStr(req.body?.tenantName);
    const mode = req.body?.mode; // AppMode enum (KID/ASSET)
    const adminName = toStr(req.body?.adminName);
    const email = toStr(req.body?.email).toLowerCase();
    const phone = req.body?.phone ? toStr(req.body.phone) : null;
    const password = toStr(req.body?.password);

    if (!tenantName || !adminName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "tenantName, adminName, email, and password are required",
      });
    }

    // Safety: prevent creating a second tenant with same name (optional)
    const existingTenant = await prisma.tenant.findFirst({ where: { name: tenantName } });
    if (existingTenant) {
      return res.status(409).json({ success: false, message: "Tenant name already exists" });
    }

    // Transaction: create tenant + admin user
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          ...(mode ? { mode } : {}),
        },
        select: tenantSelect,
      });

      // ensure user unique per tenant
      const existingUser = await tx.user.findFirst({
        where: {
          tenantId: tenant.id,
          OR: [{ email }, phone ? { phone } : undefined].filter(Boolean),
        },
        select: { id: true },
      });

      if (existingUser) {
        throw Object.assign(new Error("Admin user already exists in this tenant"), { code: "P2002" });
      }

      const admin = await tx.user.create({
        data: {
          name: adminName,
          email,
          phone,
          password: await bcrypt.hash(password, 10),
          role: "ADMIN",
          tenantId: tenant.id,
        },
        select: { id: true, name: true, email: true, phone: true, role: true, tenantId: true, createdAt: true },
      });

      return { tenant, admin };
    });

    // If you have login/token creation elsewhere, you can return token here too.
    // For now, return tenant + admin; user then logs in via /api/auth/login to get token.
    return res.status(201).json({
      success: true,
      message: "Tenant + admin created. Now login to get a token.",
      data: result,
    });
  } catch (err) {
    return prismaError(res, err, "Failed to bootstrap tenant");
  }
});

/* =========================
   AUTH: Who am I (debug)
   GET /api/tenants/_whoami
========================= */
router.get("/_whoami", authMiddleware, async (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user?.id,
      role: req.user?.role,
      tenantId: req.user?.tenantId,
    },
  });
});

/* =========================
   AUTH: My tenant
========================= */

// GET /api/tenants/me
router.get("/me", authMiddleware, requireTenant, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: tenantSelect,
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });
    return res.json({ success: true, data: tenant });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch tenant");
  }
});

// PUT /api/tenants/me  (update own tenant — no super admin required)
router.put("/me", authMiddleware, requireTenant, async (req, res) => {
  try {
    const name = req.body?.name !== undefined ? toStr(req.body.name) : undefined;
    const mode = req.body?.mode !== undefined ? req.body.mode : undefined;
    const logoUrl = req.body?.logoUrl !== undefined ? (req.body.logoUrl ? toStr(req.body.logoUrl) : null) : undefined;
    const address = req.body?.address !== undefined ? (req.body.address ? toStr(req.body.address) : null) : undefined;
    const phone = req.body?.phone !== undefined ? (req.body.phone ? toStr(req.body.phone) : null) : undefined;

    if (name !== undefined && name.length === 0) {
      return res.status(400).json({ success: false, message: "name cannot be empty" });
    }

    const updated = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(phone !== undefined ? { phone } : {}),
      },
      select: tenantSelect,
    });

    return res.json({ success: true, message: "Tenant updated", data: updated });
  } catch (err) {
    return prismaError(res, err, "Failed to update tenant");
  }
});

export default router;