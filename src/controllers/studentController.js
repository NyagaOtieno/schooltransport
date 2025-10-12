import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

// 🧩 Utility function for clean error handling
const handleError = (res, error, message = "Server error") => {
  console.error(error);
  res.status(500).json({
    status: "error",
    message,
    detail: error.message,
  });
};

// Common Prisma include object for students
const studentInclude = { school: true, bus: true, parent: { include: { user: true } } };

// -----------------------------
// Get all students
// -----------------------------
export const getStudents = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: studentInclude,
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: students.length, data: students });
  } catch (error) {
    handleError(res, error, "Failed to fetch students");
  }
};

// -----------------------------
// Get single student
// -----------------------------
export const getStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.findUnique({
      where: { id },
      include: studentInclude,
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    res.json({ status: "success", data: student });
  } catch (error) {
    handleError(res, error, "Failed to fetch student");
  }
};

// -----------------------------
// Create student (safe parent-user linkage)
// -----------------------------
export const createStudent = async (req, res) => {
  try {
    const { name, grade, latitude, longitude, busId, schoolId, parentName, parentPhone, parentEmail } = req.body;

    if (!name || !grade || !schoolId) {
      return res.status(400).json({ status: "error", message: "Name, grade, and schoolId are required" });
    }

    // Step 1: Create student (without parentId initially)
    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId },
    });

    let parent = null;
    let userParent = null;

    // Step 2: Handle parent + user linkage
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

      if (!parent) parent = await prisma.parent.create({ data: {} });

      await prisma.student.update({ where: { id: student.id }, data: { parentId: parent.id } });

      if (parent.user) {
        userParent = await prisma.user.update({
          where: { id: parent.user.id },
          data: {
            name: parentName || parent.user.name,
            phone: parentPhone || parent.user.phone,
            email: parentEmail || parent.user.email,
          },
        });
      } else {
        if (parentEmail) {
          userParent = await prisma.user.findUnique({
            where: { email_schoolId: { email: parentEmail, schoolId } },
          }).catch(() => null);
        }
        if (!userParent && parentPhone) {
          userParent = await prisma.user.findUnique({
            where: { phone_schoolId: { phone: parentPhone, schoolId } },
          }).catch(() => null);
        }

        if (!userParent) {
          const passwordHash = await bcrypt.hash("changeme", 10);
          userParent = await prisma.user.create({
            data: {
              name: parentName || "Parent",
              phone: parentPhone || null,
              email: parentEmail || null,
              password: passwordHash,
              schoolId,
              role: "PARENT",
            },
          });
        }

        await prisma.parent.update({ where: { id: parent.id }, data: { userId: userParent.id } });
      }
    }

    res.status(201).json({
      status: "success",
      message: "Student created successfully",
      student,
      parent,
      userParent,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// -----------------------------
// Update student + parent-user linkage
// -----------------------------
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const { parentName, parentPhone, parentEmail, ...studentData } = req.body;

    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    const updatedStudent = await prisma.student.update({ where: { id }, data: studentData });

    if (parentPhone || parentEmail || parentName) {
      let parent = student.parent;
      let userParent = parent?.user;

      if (!parent) {
        parent = await prisma.parent.create({ data: {} });
        await prisma.student.update({ where: { id }, data: { parentId: parent.id } });
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
        await prisma.user.update({
          where: { id: userParent.id },
          data: {
            name: parentName || userParent.name,
            phone: parentPhone || userParent.phone,
            email: parentEmail || userParent.email,
          },
        });
      }
    }

    res.json({ status: "success", message: "Student updated successfully", student: updatedStudent });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
};

// -----------------------------
// Delete student + cleanup parent/user
// -----------------------------
export const deleteStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    const parent = student.parent;
    const userParent = parent?.user;

    await prisma.student.delete({ where: { id } });

    if (parent) {
      const remaining = await prisma.student.count({ where: { parentId: parent.id } });
      if (remaining === 0) {
        if (userParent) await prisma.user.delete({ where: { id: userParent.id } });
        await prisma.parent.delete({ where: { id: parent.id } });
      }
    }

    res.json({ status: "success", message: "Student deleted successfully", studentId: id });
  } catch (error) {
    handleError(res, error, "Failed to delete student");
  }
};
