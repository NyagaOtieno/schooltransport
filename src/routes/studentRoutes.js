import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

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
      const passwordHash = await bcrypt.hash("changeme", 10);
      const user = await prisma.user.create({
        data: { name: parentName, phone: parentPhone, email: parentEmail, schoolId, role: "PARENT", password: passwordHash },
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
// UPDATE a student + safely handle parent info
// -----------------------------
router.put("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);
    const { parentName, parentPhone, parentEmail, ...studentData } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { parent: { include: { user: true } } },
    });
    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    // Update student basic info
    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: studentData,
      include: studentInclude,
    });

    // Handle parent info safely
    if (parentName || parentPhone || parentEmail) {
      let parent = student.parent;
      let userParent = parent?.user;

      if (!parent) {
        parent = await prisma.parent.create({ data: { schoolId: student.schoolId } });
        await prisma.student.update({ where: { id: studentId }, data: { parentId: parent.id } });
      }

      if (!userParent) {
        const passwordHash = await bcrypt.hash("changeme", 10);
        userParent = await prisma.user.create({
          data: {
            name: parentName || "Parent",
            phone: parentPhone || null,
            email: parentEmail || null,
            password: passwordHash,
            schoolId: student.schoolId,
            role: "PARENT",
          },
        });
        await prisma.parent.update({ where: { id: parent.id }, data: { userId: userParent.id } });
      } else {
        const dataToUpdate = {};
        if (parentName) dataToUpdate.name = parentName;
        if (parentPhone) dataToUpdate.phone = parentPhone;
        if (parentEmail) dataToUpdate.email = parentEmail;

        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.user.update({
            where: { id: userParent.id },
            data: dataToUpdate,
          });
        }
      }
    }

    res.json({ status: "success", student: updatedStudent });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
});

// -----------------------------
// DELETE a student + cleanup parent/user if no other students
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const studentId = parseId(req.params.id);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { parent: { include: { user: true } } },
    });
    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    const parent = student.parent;
    const userParent = parent?.user;

    await prisma.student.delete({ where: { id: studentId } });

    if (parent) {
      const remainingStudents = await prisma.student.count({ where: { parentId: parent.id } });
      if (remainingStudents === 0) {
        if (userParent) await prisma.user.delete({ where: { id: userParent.id } });
        await prisma.parent.delete({ where: { id: parent.id } });
      }
    }

    res.json({ status: "success", message: "Student deleted successfully", studentId });
  } catch (error) {
    handleError(res, error, "Failed to delete student");
  }
});

export default router;
