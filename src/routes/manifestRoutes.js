import express from "express";
import prisma from "../middleware/prisma.js";
import { notifyRecipient, notifyParent } from "../services/notification.service.js";

const router = express.Router();

/** ✅ Map API status to Prisma enum */
function toManifestStatus(status) {
  if (!status) return null;
  const s = status.toString().toLowerCase();

  // Accept both old and new values
  if (["checked_in", "onboard", "onboarded", "checkin", "in"].includes(s)) return "CHECKED_IN";
  if (["checked_out", "offboard", "offboarded", "checkout", "out"].includes(s)) return "CHECKED_OUT";

  // Already enum?
  if (["CHECKED_IN", "CHECKED_OUT"].includes(status)) return status;

  return null;
}

// ✅ GET all manifests
router.get("/", async (req, res) => {
  try {
    const manifests = await prisma.manifest.findMany({
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: manifests });
  } catch (error) {
    console.error("Error fetching manifests:", error);
    res.status(500).json({ success: false, message: "Server error fetching manifests" });
  }
});

// ✅ GET manifest by ID
router.get("/:id", async (req, res) => {
  try {
    const manifest = await prisma.manifest.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
    });

    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" });
    res.status(200).json({ success: true, data: manifest });
  } catch (error) {
    console.error("Error fetching manifest:", error);
    res.status(500).json({ success: false, message: "Server error fetching manifest" });
  }
});

// ✅ CREATE manifest with morning/evening and SMS support
router.post("/", async (req, res) => {
  try {
    // ✅ Support student OR asset
    const { studentId, assetId, busId, assistantId, status, latitude, longitude, session } = req.body;

    // Must provide exactly one
    if (!!studentId === !!assetId) {
      return res.status(400).json({
        success: false,
        message: "Provide exactly one: studentId OR assetId",
      });
    }

    // ✅ Map to enum (Prisma expects CHECKED_IN / CHECKED_OUT)
    const statusEnum = toManifestStatus(status);
    if (!statusEnum) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use CHECKED_IN/CHECKED_OUT or onBoard/offBoard.",
      });
    }

    // Validate bus, assistant existence
    const bus = await prisma.bus.findUnique({ where: { id: Number(busId) } });
    const assistant = await prisma.user.findUnique({ where: { id: Number(assistantId) } });

    if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    if (!assistant || assistant.role !== "ASSISTANT") {
      return res.status(400).json({ success: false, message: "Assistant not found or invalid role" });
    }

    // Ensure assistant assigned to this bus
    if (bus.assistantId !== assistant.id) {
      return res.status(400).json({ success: false, message: "Assistant not assigned to this bus" });
    }

    // ✅ Determine MORNING / EVENING session
    const now = new Date();
    const hours = now.getHours();
    const sessionValue = session || (hours < 12 ? "MORNING" : "EVENING");

    // ✅ Prevent duplicate check-in/check-out (per subject)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const existingManifest = await prisma.manifest.findFirst({
      where: {
        busId: Number(busId),
        status: statusEnum,
        session: sessionValue,
        createdAt: { gte: todayStart, lte: todayEnd },

        // scope uniqueness by subject
        ...(studentId ? { studentId: Number(studentId) } : {}),
        ...(assetId ? { assetId: Number(assetId) } : {}),
      },
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

    // ✅ Fetch subject + recipient (Parent table = recipient for both modes)
    let subject = null;
    let mode = "KID";

    if (studentId) {
      subject = await prisma.student.findUnique({
        where: { id: Number(studentId) },
        include: {
          parent: { include: { user: true } },
          school: true,
        },
      });
      if (!subject) return res.status(404).json({ success: false, message: "Student not found" });
      mode = subject.school?.mode || "KID";
    } else {
      subject = await prisma.asset.findUnique({
        where: { id: Number(assetId) },
        include: {
          parent: { include: { user: true } },
          school: true,
        },
      });
      if (!subject) return res.status(404).json({ success: false, message: "Asset not found" });
      mode = subject.school?.mode || "ASSET";
    }

    // ✅ Create manifest
    const manifest = await prisma.manifest.create({
      data: {
        studentId: studentId ? Number(studentId) : null,
        assetId: assetId ? Number(assetId) : null,
        busId: Number(busId),
        assistantId: Number(assistantId),
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        status: statusEnum,
        session: sessionValue,

        // optional timestamps
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

    // 🔔 Send SMS notification (new engine)
    try {
      const recipientUser = subject?.parent?.user;
      const recipientPhone = recipientUser?.phone;
      const recipientName = (recipientUser?.name || "Recipient").split(" ")[0];
      const subjectName = subject?.name || "Item";

      if (recipientPhone) {
        // ✅ Prefer new generic notifier
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

    // ✅ Backward compatibility (optional)
    // If you still want the old parent message format ONLY for Kid mode:
    // (You can remove this block if you don't need it.)
   
    if (mode === "KID") {
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
    }
   

    res.status(201).json({
      success: true,
      message: `Manifest created successfully for ${sessionValue} session`,
      data: manifest,
    });
  } catch (error) {
    console.error("Error creating manifest:", error);
    res.status(500).json({ success: false, message: "Server error creating manifest" });
  }
});

// ✅ UPDATE manifest (keep your style, but make enum-safe + timestamps)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const payload = { ...req.body };

    // If status provided, map it + set timestamps
    if (payload.status) {
      const statusEnum = toManifestStatus(payload.status);
      if (!statusEnum) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      payload.status = statusEnum;

      const now = new Date();
      if (statusEnum === "CHECKED_IN") payload.boardingTime = now;
      if (statusEnum === "CHECKED_OUT") payload.alightingTime = now;
    }

    const updated = await prisma.manifest.update({
      where: { id: Number(id) },
      data: payload,
      include: { student: true, asset: true, bus: true, assistant: true },
    });

    res.status(200).json({ success: true, message: "Manifest updated successfully", data: updated });
  } catch (error) {
    console.error("Error updating manifest:", error);
    res.status(500).json({ success: false, message: "Server error updating manifest" });
  }
});

// ✅ DELETE manifest
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.manifest.delete({ where: { id: Number(id) } });
    res.status(200).json({ success: true, message: "Manifest deleted successfully" });
  } catch (error) {
    console.error("Error deleting manifest:", error);
    res.status(500).json({ success: false, message: "Server error deleting manifest" });
  }
});

export default router;
