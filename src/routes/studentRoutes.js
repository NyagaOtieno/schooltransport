import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Common Prisma include structure
const studentInclude = {
  school: true,
  bus: true,
  parent: { include: { user: true } },
};

// Helper to validate IDs
const parseId = (id) => {
  const parsed = Number(id);
  if (isNaN(parsed)) throw new Error("Invalid ID");
  return parsed;
};

// Unified error handler
const handleError = (res, error, message = "Server error") => {
  console.error(error);
  res.status(500).json({ status: "error", message, detail: error.message });
};

// -----------------------------
// GET all students
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: studentInclude,
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: students.length, data: students });
  } catch (error) {
    handleError(res, error, "Failed to fetch students");
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
      include: studentInclude,
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    res.json({ status: "success", data: student });
  } catch (error) {
    handleError(res, error, "Failed to fetch student");
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

    // Validate school & bus
    const [school, bus] = await Promise.all([
      prisma.school.findUnique({ where: { id: schoolId } }),
      prisma.bus.findUnique({ where: { id: busId } }),
    ]);
    if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    if (!bus) return res.status(400).json({ status: "error", message: "Invalid busId" });
    if (bus.schoolId !== schoolId) return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });

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

    // Create parent + user if not exists
    if (!parent) {
      const user = await prisma.user.create({
        data: { name: parentName, phone: parentPhone, email: parentEmail, schoolId, role: "PARENT" },
      });
      parent = await prisma.parent.create({
        data: { userId: user.id, schoolId },
        include: { user: true },
      });
    }

    // Create student
    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId, parentId: parent.id },
      include: studentInclude,
    });

    res.json({ status: "success", student });
  } catch (error) {
    handleError(res, error, "Failed to create student");
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
    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    // Validate school, bus, parent if provided
    const validations = [];
    if (schoolId) validations.push(prisma.school.findUnique({ where: { id: schoolId } }));
    if (busId) validations.push(prisma.bus.findUnique({ where: { id: busId } }));
    if (parentId) validations.push(prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } }));

    const [school, bus, parent] = await Promise.all(validations);
    if (schoolId && !school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    if (busId && !bus) return res.status(400).json({ status: "error", message: "Invalid busId" });
    if (busId && schoolId && bus && bus.schoolId !== schoolId)
      return res.status(400).json({ status: "error", message: "Bus does not belong to this school" });
    if (parentId && !parent) return res.status(400).json({ status: "error", message: "Invalid parentId" });
    if (parentId && schoolId && parent?.user?.schoolId !== schoolId)
      return res.status(400).json({ status: "error", message: "Parent does not belong to this school" });

    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: req.body,
      include: studentInclude,
    });

    res.json({ status: "success", student: updatedStudent });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
});

// -----------------------------
// DELETE a student
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    await prisma.student.delete({ where: { id: studentId } });
    res.json({ status: "success", message: "Student deleted" });
  } catch (error) {
    handleError(res, error, "Failed to delete student");
  }
});

export default router;
