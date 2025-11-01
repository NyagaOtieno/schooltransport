import express from "express";
import prisma from "../middleware/prisma.js";
import { notifyParent } from "../services/notification.service.js"; // ✅ Import SMS service

const router = express.Router();

// ✅ GET all manifests
router.get("/", async (req, res) => {
  try {
    const manifests = await prisma.manifest.findMany({
      include: { student: true, bus: true, assistant: true },
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
      include: { student: true, bus: true, assistant: true },
    });
    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" });
    res.status(200).json({ success: true, data: manifest });
  } catch (error) {
    console.error("Error fetching manifest:", error);
    res.status(500).json({ success: false, message: "Server error fetching manifest" });
  }
});

// ✅ CREATE manifest with morning/evening support
router.post("/", async (req, res) => {
  try {
    const { studentId, busId, assistantId, status, latitude, longitude, session } = req.body;

    // Validate student, bus, assistant existence
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    const assistant = await prisma.user.findUnique({ where: { id: assistantId } });

    if (!student) return res.status(404).json({ success: false, message: "Student not found" });
    if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    if (!assistant || assistant.role !== "ASSISTANT") {
      return res.status(400).json({ success: false, message: "Assistant not found or invalid role" });
    }

    // Ensure assistant is assigned to this bus
    if (bus.assistantId !== assistant.id) {
      return res.status(400).json({ success: false, message: "Assistant not assigned to this bus" });
    }

    // Determine MORNING / EVENING session
    const now = new Date();
    const hours = now.getHours();
    const sessionValue = session || (hours < 12 ? "MORNING" : "EVENING");

    // Prevent duplicate check-in/check-out for same student, bus, session, and day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const existingManifest = await prisma.manifest.findFirst({
      where: {
        studentId,
        busId,
        status,
        session: sessionValue,
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });

    if (existingManifest) {
      return res.status(400).json({
        success: false,
        message: `Student has already ${status.toLowerCase()} for this bus in the ${sessionValue.toLowerCase()} session today.`,
      });
    }

    // ✅ Create manifest
    const manifest = await prisma.manifest.create({
      data: {
        studentId,
        busId,
        assistantId,
        latitude,
        longitude,
        status,
        session: sessionValue,
      },
    });

    // 🔔 Send SMS notification
    try {
      const eventType = status === "ONBOARD" ? "onBoard" : "offBoard";
      const busNumber = bus?.numberPlate || bus?.id;
      await notifyParent(eventType, student, busNumber);
    } catch (smsError) {
      console.error("❌ SMS sending error:", smsError);
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

// ✅ UPDATE manifest
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.manifest.update({
      where: { id: Number(id) },
      data: req.body,
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
