// src/routes/assetRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Helper: require schoolId from token
 */
function requireSchool(req, res) {
  const schoolId = req.user?.schoolId;
  if (!schoolId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing schoolId" });
    return null;
  }
  return Number(schoolId);
}

/* =========================================================
   ✅ ASSET TRACKING (AUTH REQUIRED)
   ========================================================= */

// ✅ GET asset by TAG (scoped by token schoolId)
router.get("/tag/:tag", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const tag = req.params.tag;

    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId },
      include: {
        parent: { include: { user: true } },
        bus: true,
        school: true,
      },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    res.status(200).json({ success: true, data: asset });
  } catch (error) {
    console.error("Error fetching asset by tag:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset" });
  }
});

// ✅ GET manifest history for asset TAG (scoped)
router.get("/tag/:tag/manifests", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const tag = req.params.tag;

    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId },
      select: { id: true },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    const manifests = await prisma.manifest.findMany({
      where: { assetId: asset.id },
      include: {
        bus: true,
        assistant: true,
        asset: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, count: manifests.length, data: manifests });
  } catch (error) {
    console.error("Error fetching asset manifests:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset manifests" });
  }
});

// ✅ CREATE manifest for asset TAG (scoped)
router.post("/tag/:tag/manifests", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const tag = req.params.tag;
    const { busId, assistantId, status, latitude, longitude, session } = req.body;

    if (!busId || !status) {
      return res.status(400).json({ success: false, message: "busId and status are required" });
    }

    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId },
      select: { id: true },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), schoolId },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this school" });

    const now = new Date();
    const hours = now.getHours();
    const sessionValue = session || (hours < 12 ? "MORNING" : "EVENING");

    const statusEnum = status.toString().toUpperCase();
    if (!["CHECKED_IN", "CHECKED_OUT"].includes(statusEnum)) {
      return res.status(400).json({ success: false, message: "status must be CHECKED_IN or CHECKED_OUT" });
    }

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

    res.status(201).json({ success: true, message: "Asset manifest created successfully", data: manifest });
  } catch (error) {
    console.error("Error creating asset manifest:", error);
    res.status(500).json({ success: false, message: "Server error creating asset manifest" });
  }
});

/* =========================================================
   ✅ ASSET CRUD (SECURED: schoolId comes from token ONLY)
   ========================================================= */

// ✅ GET all assets (scoped)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assets = await prisma.asset.findMany({
      where: { schoolId },
      include: {
        parent: { include: { user: true } },
        bus: true,
        school: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: assets });
  } catch (error) {
    console.error("Error fetching assets:", error);
    res.status(500).json({ success: false, message: "Server error fetching assets" });
  }
});

// ✅ GET asset by ID (scoped)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const asset = await prisma.asset.findFirst({
      where: { id: Number(req.params.id), schoolId },
      include: {
        parent: { include: { user: true } },
        bus: true,
        school: true,
      },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });
    res.status(200).json({ success: true, data: asset });
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset" });
  }
});

// ✅ CREATE asset (scoped) — IGNORE body.schoolId
router.post("/", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const { name, type, tag, parentId, busId } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Asset name is required" });

    // Validate bus belongs to same school if provided
    if (busId) {
      const bus = await prisma.bus.findFirst({
        where: { id: Number(busId), schoolId },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this school" });
    }

    // Parent table has no schoolId field; we can only validate existence
    if (parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: Number(parentId) } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    const asset = await prisma.asset.create({
      data: {
        name: name.toString().trim(),
        type: type ?? null,
        tag: tag ?? null,
        parentId: parentId ? Number(parentId) : null,
        busId: busId ? Number(busId) : null,
        schoolId, // ✅ from token
      },
      include: {
        parent: { include: { user: true } },
        bus: true,
        school: true,
      },
    });

    res.status(201).json({ success: true, message: "Asset created successfully", data: asset });
  } catch (error) {
    console.error("Error creating asset:", error);
    res.status(500).json({ success: false, message: "Server error creating asset" });
  }
});

// ✅ UPDATE asset (scoped) — DO NOT allow changing schoolId
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const { id } = req.params;

    // Ensure asset belongs to this school
    const existing = await prisma.asset.findFirst({
      where: { id: Number(id), schoolId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Asset not found" });

    // Validate bus belongs to same school if provided
    if (req.body.busId !== undefined && req.body.busId !== null && req.body.busId !== "") {
      const bus = await prisma.bus.findFirst({
        where: { id: Number(req.body.busId), schoolId },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this school" });
    }

    // Validate parent existence if provided
    if (req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== "") {
      const parent = await prisma.parent.findUnique({ where: { id: Number(req.body.parentId) } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    // ❌ Never trust / allow schoolId updates from body
    const { schoolId: _ignoreSchoolId, ...safeBody } = req.body;

    const updated = await prisma.asset.update({
      where: { id: Number(id) },
      data: {
        ...safeBody,
        ...(safeBody.parentId !== undefined ? { parentId: safeBody.parentId ? Number(safeBody.parentId) : null } : {}),
        ...(safeBody.busId !== undefined ? { busId: safeBody.busId ? Number(safeBody.busId) : null } : {}),
        schoolId, // ✅ enforce same school always
      },
      include: {
        parent: { include: { user: true } },
        bus: true,
        school: true,
      },
    });

    res.status(200).json({ success: true, message: "Asset updated successfully", data: updated });
  } catch (error) {
    console.error("Error updating asset:", error);
    res.status(500).json({ success: false, message: "Server error updating asset" });
  }
});

// ✅ DELETE asset (scoped)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const { id } = req.params;

    // Ensure asset belongs to this school
    const existing = await prisma.asset.findFirst({
      where: { id: Number(id), schoolId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Asset not found" });

    await prisma.asset.delete({ where: { id: Number(id) } });

    res.status(200).json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    console.error("Error deleting asset:", error);
    res.status(500).json({ success: false, message: "Server error deleting asset" });
  }
});

export default router;
