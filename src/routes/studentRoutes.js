import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// -----------------------------
// GET all students
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// GET a student by ID
// -----------------------------
router.get("/:id", async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    if (isNaN(studentId)) {
      return res.status(400).json({ status: "error", message: "Invalid student ID" });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });

    if (!student) {
      return res.status(404).json({ status: "error", message: "Student not found" });
    }

    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// CREATE a new student
// -----------------------------
router.post("/", async (req, res) => {
  try {
    const { name, grade, latitude, longitude, busId, parentId, schoolId } = req.body;

    // Validate input IDs
    if (!busId || !parentId || !schoolId) {
      return res.status(400).json({ status: "error", message: "busId, parentId, and schoolId are required" });
    }

    // Validate school
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });

    // Validate bus
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) return res.status(400).json({ status: "error", message: "Invalid busId" });
    if (bus.schoolId !== schoolId) {
      return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });
    }

    // Validate parent
    const parent = await prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } });
    if (!parent) return res.status(400).json({ status: "error", message: "Invalid parentId" });
    if (parent.user.schoolId !== schoolId) {
      return res.status(400).json({ status: "error", message: "Parent does not belong to this school" });
    }

    const student = await prisma.student.create({
      data: {
        name,
        grade,
        latitude,
        longitude,
        busId,
        parentId,
        schoolId,
      },
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });

    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// UPDATE a student
// -----------------------------
router.put("/:id", async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    if (isNaN(studentId)) {
      return res.status(400).json({ status: "error", message: "Invalid student ID" });
    }

    // Validate if student exists
    const existingStudent = await prisma.student.findUnique({ where: { id: studentId } });
    if (!existingStudent) {
      return res.status(404).json({ status: "error", message: "Student not found" });
    }

    const { busId, parentId, schoolId } = req.body;

    // Optional validation if these fields are being updated
    if (schoolId) {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    }

    if (busId) {
      const bus = await prisma.bus.findUnique({ where: { id: busId } });
      if (!bus) return res.status(400).json({ status: "error", message: "Invalid busId" });
      if (schoolId && bus.schoolId !== schoolId) {
        return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });
      }
    }

    if (parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } });
      if (!parent) return res.status(400).json({ status: "error", message: "Invalid parentId" });
      if (schoolId && parent.user.schoolId !== schoolId) {
        return res.status(400).json({ status: "error", message: "Parent does not belong to this school" });
      }
    }

    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: req.body,
      include: { school: true, bus: true, parent: { include: { user: true } } },
    });

    res.json(updatedStudent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// DELETE a student
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    if (isNaN(studentId)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.delete({ where: { id: studentId } });
    res.json({ status: "success", message: "Student deleted", student });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

export default router;
