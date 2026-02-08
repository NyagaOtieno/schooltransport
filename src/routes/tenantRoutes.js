// src/routes/tenantRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const getIp = (req) =>
  req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
  req.ip ||
  "unknown";

function prismaError(res, err, fallback = "Server error") {
  console.error("❌ TenantRoutes error:", {
    code: err?.code,
    message: err?.message,
    meta: err?.meta,
  });

  if (err?.code === "P2002") {
    return res
      .status(409)
      .json({ success: false, message: "Duplicate conflict", fields: err?.meta?.target });
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

function requireAuth(req, res, next) {
  return authMiddleware(req, res, next);
}

function requireTenant(req, res, next) {
  const tenantId = toInt(req.user?.tenantId);
  if (!tenantId) {
    return res
      .status(403)
      .json({ success: false, message: "Forbidden: token missing tenantId" });
  }
  req.tenantId = tenantId;
  next();
}

/**
 * Optional: restrict admin endpoints
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ success: false, message: "Admin only" });
  }
  next();
}

function pickTenantInput(body) {
  const name = body?.name !== undefined ? String(body.name).trim() : undefined;
  const mode = body?.mode !== undefined ? body.mode : undefined; // AppMode enum validated by Prisma
  const logoUrl = body?.logoUrl !== undefined ? (body.logoUrl ? String(body.logoUrl) : null) : undefined;
  const address = body?.address !== undefined ? (body.address ? String(body.address) : null) : undefined;
  const phone = body?.phone !== undefined ? (body.phone ? String(body.phone) : null) : undefined;

  return { name, mode, logoUrl, address, phone };
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
   Routes
========================= */

/**
 * ✅ GET /api/tenants/me
 * Returns tenant info for the logged-in user (tenantId from JWT)
 */
router.get("/me", requireAuth, requireTenant, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: tenantSelect,
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    return res.json({ success: true, data: tenant });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch tenant");
  }
});

/**
 * ✅ ADMIN: GET /api/tenants
 * List all tenants
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      select: tenantSelect,
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, count: tenants.length, data: tenants });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch tenants");
  }
});

/**
 * ✅ ADMIN: GET /api/tenants/:id
 */
router.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: tenantSelect,
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });
    return res.json({ success: true, data: tenant });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch tenant");
  }
});

/**
 * ✅ ADMIN: POST /api/tenants
 * Creates a tenant
 * NOTE: In a strict multi-tenant system, tenant creation is usually only in bootstrap/admin context.
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const input = pickTenantInput(req.body);

    if (!input.name) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: input.name,
        mode: input.mode,
        logoUrl: input.logoUrl ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
      },
      select: tenantSelect,
    });

    return res.status(201).json({ success: true, message: "Tenant created", data: tenant });
  } catch (err) {
    return prismaError(res, err, "Failed to create tenant");
  }
});

/**
 * ✅ ADMIN: PUT /api/tenants/:id
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    const input = pickTenantInput(req.body);

    // prevent accidental empty name overwrite
    if (input.name !== undefined && input.name.length === 0) {
      return res.status(400).json({ success: false, message: "name cannot be empty" });
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
      select: tenantSelect,
    });

    return res.json({ success: true, message: "Tenant updated", data: tenant });
  } catch (err) {
    return prismaError(res, err, "Failed to update tenant");
  }
});

/**
 * ✅ ADMIN: DELETE /api/tenants/:id
 * Safety: in production, prefer "soft delete" (disabledAt) to avoid cascade data loss.
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    await prisma.tenant.delete({ where: { id } });

    return res.json({ success: true, message: "Tenant deleted" });
  } catch (err) {
    return prismaError(res, err, "Failed to delete tenant");
  }
});

/**
 * ✅ Health/debug helper (optional)
 * GET /api/tenants/_whoami
 */
router.get("/_whoami", requireAuth, async (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user?.id,
      role: req.user?.role,
      tenantId: req.user?.tenantId,
    },
    ip: getIp(req),
  });
});

export default router;