import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Helper to validate IDs
const parseId = (id) => {
  const parsed = Number(id);
  if (isNaN(parsed)) throw new Error("Invalid ID");
  return parsed;
};

// -----------------------------
// GET all students
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: {
        school: true,
        bus: true,
        parent: { include: { user: true } },
      },
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: students.length, data: students });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
});

// -----------------------------
// GET a student by ID
// -----------------------------
router.get("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        school: true,
        bus: true,
        parent: { include: { user: true } },
      },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    res.json({ status: "success", data: student });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
});

// -----------------------------
// CREATE a new student
// -----------------------------
router.post("/", async (req, res) => {
  try {
    const { name, grade, latitude, longitude, busId, schoolId, parentName, parentPhone, parentEmail } = req.body;

    if (!busId || !schoolId || (!parentName && !parentPhone && !parentEmail)) {
      return res.status(400).json({
        status: "error",
        message: "busId, schoolId, and parent information are required",
      });
    }

    // Validate school
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school)
      return res.status(400).json({ status: "error", message: "Invalid schoolId" });

    // Validate bus
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus)
      return res.status(400).json({ status: "error", message: "Invalid busId" });
    if (bus.schoolId !== schoolId)
      return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });

    // Check if parent exists
    let parent;
    if (parentPhone || parentEmail) {
      parent = await prisma.parent.findFirst({
        where: {
          OR: [
            parentPhone ? { user: { phone: parentPhone } } : undefined,
            parentEmail ? { user: { email: parentEmail } } : undefined,
          ].filter(Boolean),
        },
        include: { user: true },
      });
    }

    // If parent doesn't exist, create user + parent
    if (!parent) {
      const user = await prisma.user.create({
        data: { name: parentName, phone: parentPhone, email: parentEmail, schoolId },
      });

      parent = await prisma.parent.create({
        data: { userId: user.id, schoolId },
        include: { user: true },
      });
    }

    // Create student
    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId, parentId: parent.id },
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });

    res.json({ status: "success", student });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
});

// -----------------------------
// UPDATE a student
// -----------------------------
router.put("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);
    const { busId, parentId, schoolId } = req.body;

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    // Validate school if provided
    if (schoolId) {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school)
        return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    }

    // Validate bus if provided
    if (busId) {
      const bus = await prisma.bus.findUnique({ where: { id: busId } });
      if (!bus)
        return res.status(400).json({ status: "error", message: "Invalid busId" });
      if (schoolId && bus.schoolId !== schoolId)
        return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });
    }

    // Validate parent if provided
    if (parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } });
      if (!parent)
        return res.status(400).json({ status: "error", message: "Invalid parentId" });
      if (schoolId && parent.user.schoolId !== schoolId)
        return res.status(400).json({ status: "error", message: "Parent does not belong to this school" });
    }

    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: req.body,
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });

    res.json({ status: "success", student: updatedStudent });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
});

// -----------------------------
// DELETE a student
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    await prisma.student.delete({ where: { id: studentId } });
    res.json({ status: "success", message: "Student deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
});

export default router;
