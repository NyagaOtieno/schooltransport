// src/routes/assetRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

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

function handleError(res, error, message = "Server error") {
  console.error(message + ":", error);
  return res.status(500).json({ success: false, message });
}

function toManifestStatus(status) {
  if (!status) return null;
  const s = String(status).trim().toLowerCase();

  if (["checked_in", "onboard", "onboarded", "checkin", "in"].includes(s)) return "CHECKED_IN";
  if (["checked_out", "offboard", "offboarded", "checkout", "out"].includes(s)) return "CHECKED_OUT";

  const upper = String(status).trim().toUpperCase();
  if (["CHECKED_IN", "CHECKED_OUT"].includes(upper)) return upper;

  return null;
}

function getSessionValue(session) {
  if (session && ["MORNING", "EVENING"].includes(String(session).toUpperCase())) {
    return String(session).toUpperCase();
  }
  const h = new Date().getHours();
  return h < 12 ? "MORNING" : "EVENING";
}

async function findAssetByTag({ tag, tenantId }) {
  return prisma.asset.findFirst({
    where: {
      tag: String(tag).trim(),
      TenantId: tenantId,
    },
    include: {
      parent: { include: { user: true } },
      bus: true,
      Tenant: true,
    },
  });
}

/* =========================================================
   ✅ ASSET TRACKING (AUTH REQUIRED)
   ========================================================= */

// ✅ GET asset by TAG (scoped by token tenantId)
router.get("/tag/:tag", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const tag = String(req.params.tag || "").trim();
    if (!tag) return res.status(400).json({ success: false, message: "Tag is required" });

    const asset = await findAssetByTag({ tag, tenantId });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    return res.status(200).json({ success: true, data: asset });
  } catch (error) {
    return handleError(res, error, "Server error fetching asset");
  }
});

// ✅ GET manifest history for asset TAG (scoped)
router.get("/tag/:tag/manifests", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const tag = String(req.params.tag || "").trim();
    if (!tag) return res.status(400).json({ success: false, message: "Tag is required" });

    const asset = await prisma.asset.findFirst({
      where: { tag, TenantId: tenantId },
      select: { id: true },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    const manifests = await prisma.manifest.findMany({
      where: { assetId: asset.id },
      include: { bus: true, assistant: true, asset: true },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, count: manifests.length, data: manifests });
  } catch (error) {
    return handleError(res, error, "Server error fetching asset manifests");
  }
});

// ✅ CREATE manifest for asset TAG (scoped)
router.post("/tag/:tag/manifests", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const tag = String(req.params.tag || "").trim();
    if (!tag) return res.status(400).json({ success: false, message: "Tag is required" });

    const { busId, assistantId, status, latitude, longitude, session } = req.body;

    if (!busId) return res.status(400).json({ success: false, message: "busId is required" });

    const statusEnum = toManifestStatus(status);
    if (!statusEnum) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use CHECKED_IN/CHECKED_OUT (or onBoard/offBoard)",
      });
    }

    // Ensure asset belongs to tenant
    const asset = await prisma.asset.findFirst({
      where: { tag, TenantId: tenantId },
      select: { id: true },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    // Ensure bus belongs to tenant
    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), TenantId: tenantId },
      select: { id: true, assistantId: true, plateNumber: true },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });

    // (Optional but recommended) Validate assistant if provided
    if (assistantId) {
      const assistant = await prisma.user.findUnique({
        where: { id: Number(assistantId) },
        select: { id: true, role: true },
      });
      if (!assistant || String(assistant.role).toUpperCase() !== "ASSISTANT") {
        return res.status(400).json({ success: false, message: "Assistant not found or invalid role" });
      }
      // If you want strict assignment check:
      // if (bus.assistantId && bus.assistantId !== Number(assistantId)) {
      //   return res.status(400).json({ success: false, message: "Assistant not assigned to this bus" });
      // }
    }

    const sessionValue = getSessionValue(session);

    // Prevent duplicates per day (asset + status + session + bus)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const existing = await prisma.manifest.findFirst({
      where: {
        assetId: asset.id,
        busId: Number(busId),
        status: statusEnum,
        session: sessionValue,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Asset already ${statusEnum === "CHECKED_IN" ? "checked in" : "checked out"} for ${sessionValue.toLowerCase()} session today.`,
      });
    }

    const now = new Date();

    const manifest = await prisma.manifest.create({
      data: {
        assetId: asset.id,
        studentId: null,
        busId: Number(busId),
        assistantId: assistantId ? Number(assistantId) : null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        status: statusEnum,
        session: sessionValue,
        boardingTime: statusEnum === "CHECKED_IN" ? now : null,
        alightingTime: statusEnum === "CHECKED_OUT" ? now : null,
      },
      include: { asset: true, bus: true, assistant: true },
    });

    return res.status(201).json({
      success: true,
      message: "Asset manifest created successfully",
      data: manifest,
    });
  } catch (error) {
    return handleError(res, error, "Server error creating asset manifest");
  }
});

/* =========================================================
   ✅ ASSET CRUD (SECURED: TenantId comes from token ONLY)
   ========================================================= */

// ✅ GET all assets (scoped)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const assets = await prisma.asset.findMany({
      where: { TenantId: tenantId },
      include: {
        parent: { include: { user: true } },
        bus: true,
        Tenant: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, count: assets.length, data: assets });
  } catch (error) {
    return handleError(res, error, "Server error fetching assets");
  }
});

// ✅ GET asset by ID (scoped)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid asset id" });

    const asset = await prisma.asset.findFirst({
      where: { id, TenantId: tenantId },
      include: {
        parent: { include: { user: true } },
        bus: true,
        Tenant: true,
      },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });
    return res.status(200).json({ success: true, data: asset });
  } catch (error) {
    return handleError(res, error, "Server error fetching asset");
  }
});

// ✅ CREATE asset (scoped) — IGNORE body.TenantId
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { name, type, tag, parentId, busId } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Asset name is required" });
    }

    // Validate bus belongs to tenant if provided
    if (busId) {
      const bus = await prisma.bus.findFirst({ where: { id: Number(busId), TenantId: tenantId }, select: { id: true } });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    }

    // Validate parent existence if provided (Parent is global in your schema)
    if (parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: Number(parentId) }, select: { id: true } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    const asset = await prisma.asset.create({
      data: {
        name: String(name).trim(),
        type: type ?? null,
        tag: tag ? String(tag).trim() : null,
        parentId: parentId ? Number(parentId) : null,
        busId: busId ? Number(busId) : null,
        TenantId: tenantId,
      },
      include: {
        parent: { include: { user: true } },
        bus: true,
        Tenant: true,
      },
    });

    return res.status(201).json({ success: true, message: "Asset created successfully", data: asset });
  } catch (error) {
    return handleError(res, error, "Server error creating asset");
  }
});

// ✅ UPDATE asset (scoped) — DO NOT allow changing TenantId
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid asset id" });

    const existing = await prisma.asset.findFirst({
      where: { id, TenantId: tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Asset not found" });

    // Validate bus belongs to tenant if provided
    if (req.body.busId !== undefined && req.body.busId !== null && req.body.busId !== "") {
      const bus = await prisma.bus.findFirst({
        where: { id: Number(req.body.busId), TenantId: tenantId },
        select: { id: true },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
    }

    // Validate parent existence if provided
    if (req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== "") {
      const parent = await prisma.parent.findUnique({ where: { id: Number(req.body.parentId) }, select: { id: true } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    // ❌ Never allow TenantId updates from body
    const { TenantId: _ignoreTenantId, tenantId: _ignoreTenantId2, ...safeBody } = req.body;

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        ...safeBody,
        ...(safeBody.parentId !== undefined ? { parentId: safeBody.parentId ? Number(safeBody.parentId) : null } : {}),
        ...(safeBody.busId !== undefined ? { busId: safeBody.busId ? Number(safeBody.busId) : null } : {}),
        TenantId: tenantId, // enforce tenant
      },
      include: {
        parent: { include: { user: true } },
        bus: true,
        Tenant: true,
      },
    });

    return res.status(200).json({ success: true, message: "Asset updated successfully", data: updated });
  } catch (error) {
    return handleError(res, error, "Server error updating asset");
  }
});

// ✅ DELETE asset (scoped)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid asset id" });

    const existing = await prisma.asset.findFirst({
      where: { id, TenantId: tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Asset not found" });

    await prisma.asset.delete({ where: { id } });

    return res.status(200).json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    return handleError(res, error, "Server error deleting asset");
  }
});

export default router;
