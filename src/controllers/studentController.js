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

// 🧩 Get all students (with related entities)
export const getStudents = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { school: true, bus: true, parent: true },
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: students.length, data: students });
  } catch (error) {
    handleError(res, error, "Failed to fetch students");
  }
};

// 🧩 Get a single student by ID
export const getStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.findUnique({
      where: { id },
      include: { school: true, bus: true, parent: true },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    res.json({ status: "success", data: student });
  } catch (error) {
    handleError(res, error, "Failed to fetch student");
  }
};

// 🧩 Create student and link parent/user safely
export const createStudent = async (req, res) => {
  try {
    const { name, grade, latitude, longitude, busId, schoolId, parentName, parentPhone, parentEmail } = req.body;

    if (!name || !grade || !schoolId) {
      return res.status(400).json({
        status: "error",
        message: "Name, grade, and schoolId are required",
      });
    }

    // Step 1: Create student (without parentId)
    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId },
    });

    let parent = null;
    let userParent = null;

    if (parentPhone || parentEmail) {
      // Step 2: Find or create Parent
      parent = await prisma.parent.findFirst({
        where: {
          OR: [
            { user: { phone: parentPhone || undefined } },
            { user: { email: parentEmail || undefined } },
          ],
        },
        include: { user: true },
      });

      if (!parent) {
        parent = await prisma.parent.create({
          data: { name: parentName || "Parent" },
        });
      }

      // Link student to parent
      await prisma.student.update({
        where: { id: student.id },
        data: { parentId: parent.id },
      });

      // Step 3: Handle User linkage safely
      if (parent.user) {
        userParent = parent.user;
        // Optionally update name/email/phone
        await prisma.user.update({
          where: { id: userParent.id },
          data: {
            name: parentName || userParent.name,
            phone: parentPhone || userParent.phone,
            email: parentEmail || userParent.email,
          },
        });
      } else {
        // Try to find user by compound unique keys
        const emailKey = parentEmail ? { email_schoolId: { email: parentEmail, schoolId } } : undefined;
        const phoneKey = parentPhone ? { phone_schoolId: { phone: parentPhone, schoolId } } : undefined;

        userParent = emailKey
          ? await prisma.user.findUnique({ where: emailKey })
          : phoneKey
          ? await prisma.user.findUnique({ where: phoneKey })
          : null;

        if (!userParent) {
          userParent = await prisma.user.create({
            data: {
              name: parentName || parent.name,
              phone: parentPhone,
              email: parentEmail,
              password: await bcrypt.hash("changeme", 10),
              schoolId,
              role: "PARENT",
            },
          });
        }

        // Link User to Parent
        await prisma.parent.update({
          where: { id: parent.id },
          data: { userId: userParent.id },
        });
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

// 🧩 Update student and handle parent/User safely
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const { parentName, parentPhone, parentEmail, ...studentData } = req.body;

    // Fetch student with parent/user
    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    // Update student data
    const updatedStudent = await prisma.student.update({
      where: { id },
      data: studentData,
    });

    if (parentPhone || parentEmail) {
      let parent = student.parent;
      let userParent = parent?.user;

      if (!parent) {
        parent = await prisma.parent.create({ data: { name: parentName || "Parent" } });
        await prisma.student.update({ where: { id }, data: { parentId: parent.id } });
      } else {
        parent = await prisma.parent.update({
          where: { id: parent.id },
          data: { name: parentName || parent.name },
        });
      }

      // Handle User linkage
      if (userParent) {
        await prisma.user.update({
          where: { id: userParent.id },
          data: { name: parentName || userParent.name, phone: parentPhone || userParent.phone, email: parentEmail || userParent.email },
        });
      } else {
        const emailKey = parentEmail ? { email_schoolId: { email: parentEmail, schoolId: student.schoolId } } : undefined;
        const phoneKey = parentPhone ? { phone_schoolId: { phone: parentPhone, schoolId: student.schoolId } } : undefined;

        userParent = emailKey
          ? await prisma.user.findUnique({ where: emailKey })
          : phoneKey
          ? await prisma.user.findUnique({ where: phoneKey })
          : null;

        if (!userParent) {
          userParent = await prisma.user.create({
            data: {
              name: parentName || parent.name,
              phone: parentPhone,
              email: parentEmail,
              password: await bcrypt.hash("changeme", 10),
              schoolId: student.schoolId,
              role: "PARENT",
            },
          });
        }

        await prisma.parent.update({ where: { id: parent.id }, data: { userId: userParent.id } });
      }
    }

    res.json({
      status: "success",
      message: "Student updated successfully",
      student: updatedStudent,
    });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
};

// 🧩 Delete student, safely cleanup parent/user if no other students remain
export const deleteStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

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
