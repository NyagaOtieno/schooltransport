// src/routes/manifestRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { notifyRecipient, notifyParent } from "../services/notification.service.js";

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

/** ✅ Map API status to Prisma enum */
function toManifestStatus(status) {
  if (!status) return null;
  const s = status.toString().toLowerCase();

  if (["checked_in", "onboard", "onboarded", "checkin", "in"].includes(s)) return "CHECKED_IN";
  if (["checked_out", "offboard", "offboarded", "checkout", "out"].includes(s)) return "CHECKED_OUT";

  if (["CHECKED_IN", "CHECKED_OUT"].includes(status)) return status;

  return null;
}

/** ✅ Default MORNING/EVENING */
function resolveSession(session) {
  if (session && ["MORNING", "EVENING"].includes(String(session).toUpperCase())) {
    return String(session).toUpperCase();
  }
  const h = new Date().getHours();
  return h < 12 ? "MORNING" : "EVENING";
}

/** ✅ today range (for duplicate prevention) */
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/* =========================================================
   GET all manifests (tenant scoped via bus.tenantId)
   ========================================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const manifests = await prisma.manifest.findMany({
      where: {
        bus: { tenantId }, // ✅ FIXED
      },
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, count: manifests.length, data: manifests });
  } catch (error) {
    console.error("Error fetching manifests:", error);
    return res.status(500).json({ success: false, message: "Server error fetching manifests", detail: error?.message });
  }
});

/* =========================================================
   GET manifest by ID (tenant scoped via bus.tenantId)
   ========================================================= */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid manifest id" });

    const manifest = await prisma.manifest.findFirst({
      where: {
        id,
        bus: { tenantId }, // ✅ FIXED
      },
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
    });

    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" });
    return res.status(200).json({ success: true, data: manifest });
  } catch (error) {
    console.error("Error fetching manifest:", error);
    return res.status(500).json({ success: false, message: "Server error fetching manifest", detail: error?.message });
  }
});

/* =========================================================
   CREATE manifest (tenant scoped, student OR asset)
   ========================================================= */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const { studentId, assetId, busId, assistantId, status, latitude, longitude, session } = req.body;

    // Must provide exactly one
    if (!!studentId === !!assetId) {
      return res.status(400).json({ success: false, message: "Provide exactly one: studentId OR assetId" });
    }

    const statusEnum = toManifestStatus(status);
    if (!statusEnum) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use CHECKED_IN/CHECKED_OUT or onBoard/offBoard.",
      });
    }

    const busIdNum = parseId(busId);
    const assistantIdNum = parseId(assistantId);
    if (!busIdNum) return res.status(400).json({ success: false, message: "busId is required" });
    if (!assistantIdNum) return res.status(400).json({ success: false, message: "assistantId is required" });

    // ✅ Validate bus belongs to tenant
    const bus = await prisma.bus.findFirst({
      where: { id: busIdNum, tenantId }, // ✅ FIXED
      select: { id: true, plateNumber: true, assistantId: true },
    });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });

    // ✅ Validate assistant belongs to tenant + role
    const assistant = await prisma.user.findFirst({
      where: { id: assistantIdNum, tenantId, role: "ASSISTANT" }, // ✅ FIXED
      select: { id: true, name: true },
    });
    if (!assistant) return res.status(400).json({ success: false, message: "Assistant not found for this tenant" });

    // Ensure assistant assigned to this bus (keeps your original behavior)
    if (bus.assistantId !== assistant.id) {
      return res.status(400).json({ success: false, message: "Assistant not assigned to this bus" });
    }

    const sessionValue = resolveSession(session);

    // ✅ Prevent duplicates (subject + bus + status + session + day)
    const { start, end } = todayRange();
    const existingManifest = await prisma.manifest.findFirst({
      where: {
        busId: busIdNum,
        status: statusEnum,
        session: sessionValue,
        createdAt: { gte: start, lte: end },
        ...(studentId ? { studentId: Number(studentId) } : {}),
        ...(assetId ? { assetId: Number(assetId) } : {}),
      },
      select: { id: true },
    });

    if (existingManifest) {
      const subjectLabel = studentId ? "Student" : "Asset";
      return res.status(400).json({
        success: false,
        message: `${subjectLabel} has already ${
          statusEnum === "CHECKED_IN" ? "checked in" : "checked out"
        } for this bus in the ${sessionValue.toLowerCase()} session today.`,
      });
    }

    // ✅ Fetch subject (tenant-scoped) + recipient
    let subject = null;
    let mode = "KID";

    if (studentId) {
      subject = await prisma.student.findFirst({
        where: { id: Number(studentId), tenantId }, // ✅ FIXED
        include: {
          parent: { include: { user: true } },
          tenant: { select: { mode: true } }, // ✅ FIXED
        },
      });
      if (!subject) return res.status(404).json({ success: false, message: "Student not found" });
      mode = subject.tenant?.mode || "KID";
    } else {
      subject = await prisma.asset.findFirst({
        where: { id: Number(assetId), tenantId }, // ✅ FIXED
        include: {
          client: { include: { user: true } }, // ✅ FIX: Asset links to client in your schema
          tenant: { select: { mode: true } },  // ✅ FIXED
        },
      });
      if (!subject) return res.status(404).json({ success: false, message: "Asset not found" });
      mode = subject.tenant?.mode || "ASSET";
    }

    const now = new Date();

    const manifest = await prisma.manifest.create({
      data: {
        studentId: studentId ? Number(studentId) : null,
        assetId: assetId ? Number(assetId) : null,
        busId: busIdNum,
        assistantId: assistantIdNum,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        status: statusEnum,
        session: sessionValue,
        boardingTime: statusEnum === "CHECKED_IN" ? now : null,
        alightingTime: statusEnum === "CHECKED_OUT" ? now : null,
      },
      include: {
        bus: true,
        assistant: true,
        student: true,
        asset: true,
      },
    });

    // 🔔 Send SMS notification (recipient = parent.user for KID, client.user for ASSET)
    try {
      let recipientUser = null;

      if (studentId) {
        recipientUser = subject?.parent?.user;
      } else {
        recipientUser = subject?.client?.user; // ✅ FIXED for ASSET mode
      }

      const recipientPhone = recipientUser?.phone;
      const recipientName = (recipientUser?.name || "Recipient").split(" ")[0];
      const subjectName = subject?.name || "Item";

      if (recipientPhone) {
        await notifyRecipient({
          recipientName,
          recipientPhone,
          subjectName,
          eventType: statusEnum,
          busNumber: bus?.plateNumber || String(bus?.id),
          session: sessionValue,
          mode,
        });
      } else {
        console.warn(`⚠️ Missing recipient phone number for ${studentId ? "student" : "asset"}: ${subjectName}`);
      }
    } catch (smsError) {
      console.error("❌ SMS sending error:", smsError);
    }

    // Optional legacy message (Kid mode)
    if (mode === "KID") {
      try {
        const parentPhone = subject?.parent?.user?.phone;
        const parentName = (subject?.parent?.user?.name || "Parent").split(" ")[0];
        if (parentPhone) {
          const eventType = statusEnum === "CHECKED_IN" ? "onBoard" : "offBoard";
          await notifyParent({
            parentPhone,
            parentName,
            studentName: subject.name,
            eventType,
            busNumber: bus?.plateNumber || String(bus?.id),
            session: sessionValue,
          });
        }
      } catch (legacyErr) {
        console.error("❌ Legacy notifyParent error:", legacyErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Manifest created successfully for ${sessionValue} session`,
      data: manifest,
    });
  } catch (error) {
    console.error("Error creating manifest:", error);
    return res.status(500).json({ success: false, message: "Server error creating manifest", detail: error?.message });
  }
});

/* =========================================================
   UPDATE manifest (tenant scoped)
   ========================================================= */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid manifest id" });

    // ensure it belongs to tenant via bus
    const existing = await prisma.manifest.findFirst({
      where: { id, bus: { tenantId } }, // ✅ FIXED
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Manifest not found" });

    const payload = { ...req.body };

    if (payload.status) {
      const statusEnum = toManifestStatus(payload.status);
      if (!statusEnum) return res.status(400).json({ success: false, message: "Invalid status" });

      payload.status = statusEnum;
      const now = new Date();
      if (statusEnum === "CHECKED_IN") payload.boardingTime = now;
      if (statusEnum === "CHECKED_OUT") payload.alightingTime = now;
    }

    // hard safety: don’t allow moving a manifest to a bus in another tenant
    if (payload.busId !== undefined) {
      const busIdNum = parseId(payload.busId);
      if (!busIdNum) return res.status(400).json({ success: false, message: "Invalid busId" });

      const bus = await prisma.bus.findFirst({
        where: { id: busIdNum, tenantId }, // ✅ FIXED
        select: { id: true },
      });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found for this tenant" });
      payload.busId = busIdNum;
    }

    const updated = await prisma.manifest.update({
      where: { id },
      data: payload,
      include: { student: true, asset: true, bus: true, assistant: true },
    });

    return res.status(200).json({ success: true, message: "Manifest updated successfully", data: updated });
  } catch (error) {
    console.error("Error updating manifest:", error);
    return res.status(500).json({ success: false, message: "Server error updating manifest", detail: error?.message });
  }
});

/* =========================================================
   DELETE manifest (tenant scoped)
   ========================================================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid manifest id" });

    // ensure it belongs to tenant
    const existing = await prisma.manifest.findFirst({
      where: { id, bus: { tenantId } }, // ✅ FIXED
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Manifest not found" });

    await prisma.manifest.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Manifest deleted successfully" });
  } catch (error) {
    console.error("Error deleting manifest:", error);
    return res.status(500).json({ success: false, message: "Server error deleting manifest", detail: error?.message });
  }
});

export default router;