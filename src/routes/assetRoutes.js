// src/routes/assetRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * ✅ ASSET TRACKING (AUTH REQUIRED)
 * These are NEW routes for tracking; they don't break your CRUD.
 */

// ✅ GET asset by TAG (scoped by token schoolId)
router.get("/tag/:tag", authMiddleware, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(403).json({ success: false, message: "Forbidden: token missing schoolId" });
    }

    const tag = req.params.tag;

    const asset = await prisma.asset.findFirst({
      where: {
        tag,
        schoolId: Number(schoolId),
      },
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
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(403).json({ success: false, message: "Forbidden: token missing schoolId" });
    }

    const tag = req.params.tag;

    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId: Number(schoolId) },
      select: { id: true },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    const manifests = await prisma.manifest.findMany({
      where: { assetId: asset.id },
      include: { bus: true, assistant: true, asset: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, count: manifests.length, data: manifests });
  } catch (error) {
    console.error("Error fetching asset manifests:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset manifests" });
  }
});

// ✅ CREATE manifest for asset TAG (scoped) — for dispatch/delivery scans
router.post("/tag/:tag/manifests", authMiddleware, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(403).json({ success: false, message: "Forbidden: token missing schoolId" });
    }

    const tag = req.params.tag;
    const { busId, assistantId, status, latitude, longitude, session } = req.body;

    if (!busId || !status) {
      return res.status(400).json({ success: false, message: "busId and status are required" });
    }

    const asset = await prisma.asset.findFirst({
      where: { tag, schoolId: Number(schoolId) },
      select: { id: true },
    });

    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });

    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), schoolId: Number(schoolId) },
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


// ✅ GET all assets
router.get("/", async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
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

// ✅ GET asset by ID
router.get("/:id", async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: Number(req.params.id) },
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

// ✅ CREATE asset
router.post("/", async (req, res) => {
  try {
    const { name, type, tag, parentId, busId, schoolId } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Asset name is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    if (busId) {
      const bus = await prisma.bus.findUnique({ where: { id: Number(busId) } });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    }

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
        schoolId: Number(schoolId),
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

// ✅ UPDATE asset
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (req.body.busId) {
      const bus = await prisma.bus.findUnique({ where: { id: Number(req.body.busId) } });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    }
    if (req.body.parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: Number(req.body.parentId) } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    const updated = await prisma.asset.update({
      where: { id: Number(id) },
      data: {
        ...req.body,
        ...(req.body.parentId !== undefined ? { parentId: req.body.parentId ? Number(req.body.parentId) : null } : {}),
        ...(req.body.busId !== undefined ? { busId: req.body.busId ? Number(req.body.busId) : null } : {}),
        ...(req.body.schoolId !== undefined ? { schoolId: Number(req.body.schoolId) } : {}),
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

// ✅ DELETE asset
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.asset.delete({ where: { id: Number(id) } });
    res.status(200).json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    console.error("Error deleting asset:", error);
    res.status(500).json({ success: false, message: "Server error deleting asset" });
  }
});

export default router;
