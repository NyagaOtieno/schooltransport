// src/routes/driverRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import bcrypt from "bcryptjs";

const router = express.Router();

/* =========================
   Helpers
   ========================= */
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

function parseId(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function handlePrismaError(res, err) {
  if (err?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Driver not found" });
  }
  return null;
}

/* =========================================================
   GET all drivers (tenant-scoped)
   ========================================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER", TenantId: tenantId },
      include: {
        driverBuses: true, // ✅ your schema: User.driverBuses @relation("DriverBus")
      },
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, count: drivers.length, data: drivers });
  } catch (err) {
    console.error("Error fetching drivers:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   GET driver by ID (tenant-scoped)
   ========================================================= */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid driver id" });

    const driver = await prisma.user.findFirst({
      where: { id, role: "DRIVER", TenantId: tenantId },
      include: { driverBuses: true },
    });

    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });
    return res.json({ success: true, data: driver });
  } catch (err) {
    console.error(`Error fetching driver ${req.params.id}:`, err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   CREATE driver (tenant-scoped)
   - Optional: assign to a bus (Bus.driverId)
   ========================================================= */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const name = safeString(req.body.name);
    const email = safeString(req.body.email);
    const phone = safeString(req.body.phone);
    const busId = toIntOrNull(req.body.busId);
    const password = req.body.password; // optional

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "name and email are required" });
    }

    // block duplicates inside tenant
    const existing = await prisma.user.findFirst({
      where: {
        TenantId: tenantId,
        OR: [
          { email },
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });
    }

    // optional: validate bus belongs to tenant
    if (busId) {
      const bus = await prisma.bus.findFirst({
        where: { id: busId, TenantId: tenantId },
        select: { id: true },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    }

    const hashedPassword = await bcrypt.hash(password || "changeme", 10);

    const driver = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashedPassword,
        role: "DRIVER",
        TenantId: tenantId, // ✅ from token only
      },
      select: { id: true, name: true, email: true, phone: true, role: true, TenantId: true, createdAt: true },
    });

    // optional: assign to bus
    if (busId) {
      await prisma.bus.update({
        where: { id: busId },
        data: { driverId: driver.id },
      });
    }

    return res.status(201).json({ success: true, message: "Driver created", data: driver });
  } catch (err) {
    console.error("Error creating driver:", err);
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   ASSIGN driver to bus (tenant-safe)
   POST /drivers/:id/assign-bus   { busId }
   ========================================================= */
router.post("/:id/assign-bus", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const driverId = parseId(req.params.id);
    const busId = toIntOrNull(req.body.busId);

    if (!driverId) return res.status(400).json({ success: false, message: "Invalid driver id" });
    if (!busId) return res.status(400).json({ success: false, message: "busId is required" });

    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER", TenantId: tenantId },
      select: { id: true },
    });
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    const bus = await prisma.bus.findFirst({
      where: { id: busId, TenantId: tenantId },
      select: { id: true },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });

    const updatedBus = await prisma.bus.update({
      where: { id: busId },
      data: { driverId: driverId },
      include: { driver: true, assistant: true },
    });

    return res.json({ success: true, message: "Driver assigned to bus", data: updatedBus });
  } catch (err) {
    console.error("Error assigning driver to bus:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   UNASSIGN driver from bus (tenant-safe)
   POST /drivers/:id/unassign-bus  { busId }
   ========================================================= */
router.post("/:id/unassign-bus", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const driverId = parseId(req.params.id);
    const busId = toIntOrNull(req.body.busId);

    if (!driverId) return res.status(400).json({ success: false, message: "Invalid driver id" });
    if (!busId) return res.status(400).json({ success: false, message: "busId is required" });

    const bus = await prisma.bus.findFirst({
      where: { id: busId, TenantId: tenantId },
      select: { id: true, driverId: true },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    if (bus.driverId !== driverId) {
      return res.status(400).json({ success: false, message: "This driver is not assigned to that bus" });
    }

    const updatedBus = await prisma.bus.update({
      where: { id: busId },
      data: { driverId: null },
      include: { driver: true, assistant: true },
    });

    return res.json({ success: true, message: "Driver unassigned from bus", data: updatedBus });
  } catch (err) {
    console.error("Error unassigning driver from bus:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   UPDATE driver (tenant-scoped)
   - Never allow TenantId or role changes from body
   ========================================================= */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid driver id" });

    const existing = await prisma.user.findFirst({
      where: { id, role: "DRIVER", TenantId: tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Driver not found" });

    const { TenantId: _t1, tenantId: _t2, role: _r, password: _pw, ...safeBody } = req.body || {};

    // optional password update
    const updateData = { ...safeBody };
    if (req.body?.password) {
      updateData.password = await bcrypt.hash(String(req.body.password), 10);
    }

    // enforce tenant + role
    updateData.TenantId = tenantId;
    updateData.role = "DRIVER";

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, phone: true, role: true, TenantId: true, updatedAt: true },
    });

    return res.json({ success: true, message: "Driver updated", data: updated });
  } catch (err) {
    console.error(`Error updating driver ${req.params.id}:`, err);
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   DELETE driver (tenant-scoped)
   - Unassign from buses first
   ========================================================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid driver id" });

    const driver = await prisma.user.findFirst({
      where: { id, role: "DRIVER", TenantId: tenantId },
      select: { id: true },
    });
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    await prisma.bus.updateMany({
      where: { TenantId: tenantId, driverId: id },
      data: { driverId: null },
    });

    await prisma.user.delete({ where: { id } });

    return res.json({ success: true, message: "Driver deleted" });
  } catch (err) {
    console.error(`Error deleting driver ${req.params.id}:`, err);
    const handled = handlePrismaError(res, err);
    if (handled) return;
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
