import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// GET all manifests
router.get("/", async (req, res) => {
  res.json(await prisma.manifest.findMany({ include: { student: true, bus: true, assistant: true } }));
});

// GET manifest by ID
router.get("/:id", async (req, res) => {
  res.json(await prisma.manifest.findUnique({ where: { id: Number(req.params.id) } }));
});

// CREATE manifest
router.post("/", async (req, res) => {
  try {
    const { studentId, busId, assistantId, status } = req.body;

    // Validate student, bus, assistant existence
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    const assistant = await prisma.user.findUnique({ where: { id: assistantId } });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });
    if (!bus) return res.status(404).json({ status: "error", message: "Bus not found" });
    if (!assistant || assistant.role !== "ASSISTANT") {
      return res.status(404).json({ status: "error", message: "Assistant not found or invalid role" });
    }

    // Ensure assistant is assigned to this bus
    if (bus.assistantId !== assistant.id) {
      return res.status(400).json({ status: "error", message: "Assistant not assigned to this bus" });
    }

    // Prevent duplicate check-in/check-out for same student, same bus, same day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const existingManifest = await prisma.manifest.findFirst({
      where: {
        studentId,
        busId,
        status,
        createdAt: {
          gte: todayStart,
          lte: todayEnd
        }
      }
    });

    if (existingManifest) {
      return res.status(400).json({
        status: "error",
        message: `Student has already ${status.toLowerCase()} for this bus today`
      });
    }

    const manifest = await prisma.manifest.create({ data: req.body });
    res.json(manifest);
  } catch (err) {
    console.error("Error creating manifest:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// UPDATE manifest
router.put("/:id", async (req, res) => {
  res.json(await prisma.manifest.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

// DELETE manifest
router.delete("/:id", async (req, res) => {
  res.json(await prisma.manifest.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
