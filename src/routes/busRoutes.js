// src/routes/busRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
function getTenantId(req, res) {
  const tenantId = req.user?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === "") {
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

function parseId(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function handlePrismaError(res, err) {
  if (err?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Bus plate already exists in this tenant" });
  }
  if (err?.code === "P2003") {
    return res.status(400).json({ success: false, message: "Invalid driverId, assistantId, or tenantId" });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Bus not found" });
  }
  return null;
}

function safeString(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Common include/select
 * ✅ Correct relation name is tenant (not Tenant)
 */
const busInclude = {
  tenant: { select: { id: true, name: true, mode: true, logoUrl: true } },
  driver: { select: { id: true, name: true, email: true, phone: true, role: true } },
  assistant: { select: { id: true, name: true, email: true, phone: true, role: true } },
};

/* =========================================================
   GET all buses (tenant-scoped)
========================================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const buses = await prisma.bus.findMany({
      where: { tenantId },
      include: busInclude,
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, count: buses.length, data: buses });
  } catch (err) {
    console.error("Error fetching buses:", err);
    return res.status(500).json({ success: false, message: "Server error", detail: err?.message });
  }
});

/* =========================================================
   GET bus by ID (tenant-scoped)
========================================================= */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const busId = parseId(req.params.id);
    if (!busId) return res.status(400).json({ success: false, message: "Invalid bus id" });

    const bus = await prisma.bus.findFirst({
      where: { id: busId, tenantId },
      include: busInclude,
    });

    if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    return res.json({ success: true, data: bus });
  } catch (err) {
    console.error("Error fetching bus " + req.params.id + ":", err);
    return res.status(500).json({ success: false, message: "Server error", detail: err?.message });
  }
});

/* =========================================================
   CREATE bus (tenant-scoped)
   - Never trust body.tenantId
========================================================= */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const name = safeString(req.body.name);
    const plateNumber = safeString(req.body.plateNumber);
    const route = safeString(req.body.route);
    const capacity = toIntOrNull(req.body.capacity);
    const driverId = toIntOrNull(req.body.driverId);
    const assistantId = toIntOrNull(req.body.assistantId);

    if (!name || !plateNumber || capacity === null) {
      return res.status(400).json({
        success: false,
        message: "name, plateNumber and capacity are required",
      });
    }

    // (Optional) validate driver/assistant belong to same tenant + correct roles
    if (driverId) {
      const driver = await prisma.user.findFirst({
        where: { id: driverId, tenantId, role: "DRIVER" },
        select: { id: true },
      });
      if (!driver) return res.status(400).json({ success: false, message: "Invalid driverId for this tenant" });
    }

    if (assistantId) {
      const assistant = await prisma.user.findFirst({
        where: { id: assistantId, tenantId, role: "ASSISTANT" },
        select: { id: true },
      });
      if (!assistant) return res.status(400).json({ success: false, message: "Invalid assistantId for this tenant" });
    }

    const bus = await prisma.bus.create({
      data: {
        name,
        plateNumber,
        capacity,
        route,
        driverId,
        assistantId,
        tenantId,
      },
      include: busInclude,
    });

    return res.status(201).json({ success: true, message: "Bus created", data: bus });
  } catch (err) {
    console.error("Error creating bus:", err);
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error", detail: err?.message });
  }
});

/* =========================================================
   UPDATE bus (tenant-scoped)
   - Never allow changing tenantId
========================================================= */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const busId = parseId(req.params.id);
    if (!busId) return res.status(400).json({ success: false, message: "Invalid bus id" });

    // Ensure bus belongs to tenant
    const existing = await prisma.bus.findFirst({
      where: { id: busId, tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Bus not found" });

    // Never accept tenantId changes (ignore any legacy keys)
    // eslint-disable-next-line no-unused-vars
    const { TenantId: _ignore1, tenantId: _ignore2, schoolId: _ignore3, ...body } = req.body || {};

    const data = {};

    if (body.name !== undefined) data.name = safeString(body.name);
    if (body.plateNumber !== undefined) data.plateNumber = safeString(body.plateNumber);
    if (body.route !== undefined) data.route = safeString(body.route);
    if (body.capacity !== undefined) data.capacity = toIntOrNull(body.capacity);

    if (body.driverId !== undefined) data.driverId = toIntOrNull(body.driverId);
    if (body.assistantId !== undefined) data.assistantId = toIntOrNull(body.assistantId);

    // validate driver/assistant role + tenant if provided
    if (data.driverId) {
      const driver = await prisma.user.findFirst({
        where: { id: data.driverId, tenantId, role: "DRIVER" },
        select: { id: true },
      });
      if (!driver) return res.status(400).json({ success: false, message: "Invalid driverId for this tenant" });
    }

    if (data.assistantId) {
      const assistant = await prisma.user.findFirst({
        where: { id: data.assistantId, tenantId, role: "ASSISTANT" },
        select: { id: true },
      });
      if (!assistant) return res.status(400).json({ success: false, message: "Invalid assistantId for this tenant" });
    }

    // enforce tenant safety
    data.tenantId = tenantId;

    const bus = await prisma.bus.update({
      where: { id: busId },
      data,
      include: busInclude,
    });

    return res.json({ success: true, message: "Bus updated", data: bus });
  } catch (err) {
    console.error("Error updating bus " + req.params.id + ":", err); 
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error", detail: err?.message });
  }
});

/* =========================================================
   DELETE bus (tenant-scoped)
========================================================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const busId = parseId(req.params.id);
    if (!busId) return res.status(400).json({ success: false, message: "Invalid bus id" });

    const existing = await prisma.bus.findFirst({
      where: { id: busId, tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Bus not found" });

    const deleted = await prisma.bus.delete({
      where: { id: busId },
      select: { id: true, name: true, plateNumber: true },
    });

    return res.json({ success: true, message: "Bus deleted", data: deleted });
  } catch (err) {
    console.error("Error deleting bus " + req.params.id + ":", err);
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error", detail: err?.message });
  }
});

export default router;