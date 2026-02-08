// src/routes/tenantRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
   ========================= */

const parseId = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Invalid id");
  return n;
};

function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  const n = Number(tenantId);
  if (!Number.isFinite(n)) {
    res.status(400).json({ success: false, message: "Invalid tenantId in token" });
    return null;
  }
  return n;
}

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* =========================
   Require auth for all routes
   ========================= */
router.use(authMiddleware);

/* =========================
   GET /api/tenants/me
   ✅ best place to add your /me
   ========================= */
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true },
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });

    res.json({ success: true, data: tenant });
  })
);

/* =========================
   GET /api/tenants
   ⚠️ If you want ADMIN to list all tenants, allow it here.
   For now, tenant-scoped: returns only current tenant.
   ========================= */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const tenants = await prisma.tenant.findMany({
      where: { id: tenantId },
      orderBy: { id: "desc" },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
    });

    res.json({ success: true, count: tenants.length, data: tenants });
  })
);

/* =========================
   GET /api/tenants/:id
   tenant-scoped: can only access own tenant
   ========================= */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (id !== tenantId) {
      return res.status(403).json({ success: false, message: "Forbidden: cannot access other tenants" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });
    res.json({ success: true, data: tenant });
  })
);

/* =========================
   POST /api/tenants
   ⚠️ Usually only platform super-admin creates tenants.
   If you need it, keep it — but protect with role checks.
   For now: allow only ADMIN.
   ========================= */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: ADMIN only" });
    }

    const { name, logoUrl, address, phone, mode } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const tenant = await prisma.tenant.create({
      data: {
        name: String(name).trim(),
        logoUrl: logoUrl ?? null,
        address: address ?? null,
        phone: phone ?? null,
        mode: mode ?? undefined, // must match enum if provided
      },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: tenant });
  })
);

/* =========================
   PUT /api/tenants/:id
   tenant-scoped: update own tenant only
   ========================= */
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (id !== tenantId) {
      return res.status(403).json({ success: false, message: "Forbidden: cannot update other tenants" });
    }

    // Prevent updating protected fields
    const { id: _id, createdAt, updatedAt, ...body } = req.body || {};

    const tenant = await prisma.tenant.update({
      where: { id },
      data: body,
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, updatedAt: true },
    });

    res.json({ success: true, message: "Tenant updated", data: tenant });
  })
);

/* =========================
   DELETE /api/tenants/:id
   ⚠️ Dangerous; usually super-admin only.
   ========================= */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: ADMIN only" });
    }

    const id = parseId(req.params.id);

    await prisma.tenant.delete({ where: { id } });
    res.json({ success: true, message: "Tenant deleted" });
  })
);

/* =========================
   Error handler
   ========================= */
router.use((err, req, res, next) => {
  console.error("tenantRoutes error:", err);
  res.status(500).json({ success: false, message: err.message || "Server error" });
});

export default router;
