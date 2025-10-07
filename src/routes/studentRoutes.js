import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// GET all students
router.get("/", async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { school: true, bus: true, parent: true },
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// GET a student by ID
router.get("/:id", async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: Number(req.params.id) },
      include: { school: true, bus: true, parent: true },
    });
    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });
    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// CREATE a new student
router.post("/", async (req, res) => {
  try {
    const { busId, parentId, schoolId } = req.body;

    // Validate foreign keys
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    const parent = await prisma.user.findUnique({ where: { id: parentId, role: "PARENT" } });
    const school = await prisma.school.findUnique({ where: { id: schoolId } });

    if (!bus) return res.status(400).json({ status: "error", message: "Invalid busId" });
    if (!parent) return res.status(400).json({ status: "error", message: "Invalid parentId" });
    if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });

    const student = await prisma.student.create({
      data: req.body,
      include: { school: true, bus: true, parent: true },
    });

    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// UPDATE a student
router.put("/:id", async (req, res) => {
  try {
    const student = await prisma.student.update({
      where: { id: Number(req.params.id) },
      data: req.body,
      include: { school: true, bus: true, parent: true },
    });
    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// DELETE a student
router.delete("/:id", async (req, res) => {
  try {
    const student = await prisma.student.delete({
      where: { id: Number(req.params.id) },
    });
    res.json({ status: "success", message: "Student deleted", student });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

export default router;
