// src/routes/assistantRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import bcrypt from "bcryptjs";

const router = express.Router();

/* =========================
   Helpers
   ========================= */
function getTenantId(req, res) {
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

function handleError(res, err, message = "Server error") {
  console.error(message + ":", err);
  return res.status(500).json({ success: false, message });
}

function safeTrim(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function safeUpper(v) {
  return safeTrim(v).toUpperCase();
}

/* =========================================================
   GET all assistants (tenant-scoped)
   Includes buses they are assigned to (Bus.assistantId)
   ========================================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistants = await prisma.user.findMany({
      where: { role: "ASSISTANT", TenantId: tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        TenantId: true,
        createdAt: true,
        // ✅ THIS matches your schema:
        // User.assistantBuses Bus[] @relation("AssistantBus")
        assistantBuses: {
          select: {
            id: true,
            name: true,
            plateNumber: true,
            route: true,
            capacity: true,
            assistantId: true,
            driverId: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, count: assistants.length, data: assistants });
  } catch (err) {
    return handleError(res, err, "Error fetching assistants");
  }
});

/* =========================================================
   GET assistant by ID (tenant-scoped)
   ========================================================= */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistantId = parseId(req.params.id);
    if (!assistantId) return res.status(400).json({ success: false, message: "Invalid assistant id" });

    const assistant = await prisma.user.findFirst({
      where: { id: assistantId, role: "ASSISTANT", TenantId: tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        TenantId: true,
        createdAt: true,
        assistantBuses: {
          select: {
            id: true,
            name: true,
            plateNumber: true,
            route: true,
            capacity: true,
            assistantId: true,
            driverId: true,
          },
        },
      },
    });

    if (!assistant) return res.status(404).json({ success: false, message: "Assistant not found" });
    return res.json({ success: true, data: assistant });
  } catch (err) {
    return handleError(res, err, "Error fetching assistant");
  }
});

/* =========================================================
   CREATE assistant (tenant-scoped)
   Optional: assign to a bus via busId
   ========================================================= */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const name = safeTrim(req.body.name);
    const email = safeTrim(req.body.email).toLowerCase();
    const phone = req.body.phone ? safeTrim(req.body.phone) : null;
    const password = req.body.password ? String(req.body.password) : "changeme";
    const busId = req.body.busId !== undefined && req.body.busId !== null && req.body.busId !== "" ? parseId(req.body.busId) : null;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "name and email are required" });
    }

    // Prevent duplicates within tenant (because you have @@unique([email, TenantId]) already,
    // but doing a friendly check gives a nicer message)
    const existing = await prisma.user.findFirst({
      where: { TenantId: tenantId, OR: [{ email }, ...(phone ? [{ phone }] : [])] },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });
    }

    // If busId provided, ensure it exists & belongs to tenant
    if (busId) {
      const bus = await prisma.bus.findFirst({
        where: { id: busId, TenantId: tenantId },
        select: { id: true },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // If busId exists, do creation + assignment as one transaction (safer)
    const result = await prisma.$transaction(async (tx) => {
      const assistant = await tx.user.create({
        data: {
          name,
          email,
          phone,
          password: hashedPassword,
          role: "ASSISTANT",
          TenantId: tenantId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          TenantId: true,
          createdAt: true,
        },
      });

      if (busId) {
        await tx.bus.update({
          where: { id: busId },
          data: { assistantId: assistant.id },
        });
      }

      return assistant;
    });

    return res.status(201).json({ success: true, message: "Assistant created", data: result });
  } catch (err) {
    return handleError(res, err, "Error creating assistant");
  }
});

/* =========================================================
   ASSIGN assistant to a bus (tenant-safe)
   POST /assistants/:id/assign-bus  { busId }
   ========================================================= */
router.post("/:id/assign-bus", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistantId = parseId(req.params.id);
    const busId = parseId(req.body.busId);

    if (!assistantId) return res.status(400).json({ success: false, message: "Invalid assistant id" });
    if (!busId) return res.status(400).json({ success: false, message: "busId is required" });

    const assistant = await prisma.user.findFirst({
      where: { id: assistantId, role: "ASSISTANT", TenantId: tenantId },
      select: { id: true },
    });
    if (!assistant) return res.status(404).json({ success: false, message: "Assistant not found" });

    const bus = await prisma.bus.findFirst({
      where: { id: busId, TenantId: tenantId },
      select: { id: true, assistantId: true },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });

    const updatedBus = await prisma.bus.update({
      where: { id: busId },
      data: { assistantId: assistantId },
      select: { id: true, name: true, plateNumber: true, assistantId: true, driverId: true, TenantId: true },
    });

    return res.json({ success: true, message: "Assistant assigned to bus", data: updatedBus });
  } catch (err) {
    return handleError(res, err, "Error assigning assistant to bus");
  }
});

/* =========================================================
   UNASSIGN assistant from a bus (tenant-safe)
   POST /assistants/:id/unassign-bus  { busId }
   ========================================================= */
router.post("/:id/unassign-bus", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistantId = parseId(req.params.id);
    const busId = parseId(req.body.busId);

    if (!assistantId) return res.status(400).json({ success: false, message: "Invalid assistant id" });
    if (!busId) return res.status(400).json({ success: false, message: "busId is required" });

    const bus = await prisma.bus.findFirst({
      where: { id: busId, TenantId: tenantId },
      select: { id: true, assistantId: true },
    });

    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    if (bus.assistantId !== assistantId) {
      return res.status(400).json({ success: false, message: "This assistant is not assigned to that bus" });
    }

    const updatedBus = await prisma.bus.update({
      where: { id: busId },
      data: { assistantId: null },
      select: { id: true, name: true, plateNumber: true, assistantId: true, driverId: true, TenantId: true },
    });

    return res.json({ success: true, message: "Assistant unassigned from bus", data: updatedBus });
  } catch (err) {
    return handleError(res, err, "Error unassigning assistant from bus");
  }
});

/* =========================================================
   UPDATE assistant (tenant-safe)
   - Prevent role changes
   - Optional password update
   ========================================================= */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistantId = parseId(req.params.id);
    if (!assistantId) return res.status(400).json({ success: false, message: "Invalid assistant id" });

    const existing = await prisma.user.findFirst({
      where: { id: assistantId, role: "ASSISTANT", TenantId: tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Assistant not found" });

    const body = req.body || {};

    // Never allow tenant/role to be changed here
    const { TenantId: _t1, tenantId: _t2, role: _r, password: rawPassword, ...safeBody } = body;

    // Normalize some fields
    if (safeBody.email !== undefined) safeBody.email = safeTrim(safeBody.email).toLowerCase();
    if (safeBody.name !== undefined) safeBody.name = safeTrim(safeBody.name);
    if (safeBody.phone !== undefined) safeBody.phone = safeBody.phone ? safeTrim(safeBody.phone) : null;

    if (rawPassword) {
      safeBody.password = await bcrypt.hash(String(rawPassword), 10);
    }

    const updated = await prisma.user.update({
      where: { id: assistantId },
      data: safeBody,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        TenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ success: true, message: "Assistant updated", data: updated });
  } catch (err) {
    return handleError(res, err, "Error updating assistant");
  }
});

/* =========================================================
   DELETE assistant (tenant-safe)
   - Unassign buses first
   ========================================================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assistantId = parseId(req.params.id);
    if (!assistantId) return res.status(400).json({ success: false, message: "Invalid assistant id" });

    const assistant = await prisma.user.findFirst({
      where: { id: assistantId, role: "ASSISTANT", TenantId: tenantId },
      select: { id: true },
    });
    if (!assistant) return res.status(404).json({ success: false, message: "Assistant not found" });

    await prisma.$transaction(async (tx) => {
      await tx.bus.updateMany({
        where: { TenantId: tenantId, assistantId: assistantId },
        data: { assistantId: null },
      });

      await tx.user.delete({ where: { id: assistantId } });
    });

    return res.json({ success: true, message: "Assistant deleted" });
  } catch (err) {
    return handleError(res, err, "Error deleting assistant");
  }
});

export default router;
