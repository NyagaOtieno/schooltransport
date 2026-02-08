// src/routes/tenantRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return Number(tenantId);
}

function parseId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function prismaError(res, err, fallback = "Server error") {
  console.error(err);

  if (err?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Duplicate conflict", detail: err?.meta });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  return res.status(500).json({ success: false, message: fallback, detail: err?.message });
}

/**
 * GET /api/tenants/me
 * Returns tenant info for the logged-in user (tenantId comes from JWT)
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true },
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });

    res.json({ success: true, data: tenant });
  } catch (err) {
    prismaError(res, err, "Failed to fetch tenant");
  }
});

/**
 * OPTIONAL ADMIN ENDPOINTS
 * If you want to restrict these to ADMIN only, add a role check:
 * if (req.user.role !== "ADMIN") return res.status(403)...
 */

// GET all tenants
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
      orderBy: { id: "desc" },
    });

    res.json({ success: true, count: tenants.length, data: tenants });
  } catch (err) {
    prismaError(res, err, "Failed to fetch tenants");
  }
});

// GET tenant by id
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
    });

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });

    res.json({ success: true, data: tenant });
  } catch (err) {
    prismaError(res, err, "Failed to fetch tenant");
  }
});

// CREATE tenant
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, mode, logoUrl, address, phone } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const tenant = await prisma.tenant.create({
      data: {
        name: name.toString().trim(),
        mode: mode || undefined,
        logoUrl: logoUrl || null,
        address: address || null,
        phone: phone || null,
      },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, createdAt: true },
    });

    res.status(201).json({ success: true, message: "Tenant created", data: tenant });
  } catch (err) {
    prismaError(res, err, "Failed to create tenant");
  }
});

// UPDATE tenant
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    const { name, mode, logoUrl, address, phone } = req.body;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name ? name.toString().trim() : "" } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(logoUrl !== undefined ? { logoUrl: logoUrl || null } : {}),
        ...(address !== undefined ? { address: address || null } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
      },
      select: { id: true, name: true, mode: true, logoUrl: true, address: true, phone: true, updatedAt: true },
    });

    res.json({ success: true, message: "Tenant updated", data: tenant });
  } catch (err) {
    prismaError(res, err, "Failed to update tenant");
  }
});

// DELETE tenant
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });

    await prisma.tenant.delete({ where: { id } });

    res.json({ success: true, message: "Tenant deleted" });
  } catch (err) {
    prismaError(res, err, "Failed to delete tenant");
  }
});

export default router;
