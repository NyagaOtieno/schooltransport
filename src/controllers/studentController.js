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
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const student = await prisma.student.findUnique({
      where: { id },
      include: { school: true, bus: true, parent: true },
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });
    res.json({ status: "success", data: student });
  } catch (error) {
    handleError(res, error, "Failed to fetch student");
  }
};

// 🧩 Create student with parent/user linkage
export const createStudent = async (req, res) => {
  try {
    const {
      name,
      grade,
      latitude,
      longitude,
      busId,
      schoolId,
      parentName,
      parentPhone,
      parentEmail,
    } = req.body;

    if (!name || !grade || !schoolId) {
      return res.status(400).json({
        status: "error",
        message: "Name, grade, and schoolId are required",
      });
    }

    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId },
    });

    let parent = null;
    let userParent = null;

    if (parentPhone || parentEmail) {
      parent = await prisma.parent.findFirst({
        where: {
          OR: [{ phone: parentPhone || "" }, { user: { email: parentEmail || "" } }],
        },
        include: { user: true },
      });

      if (!parent) {
        parent = await prisma.parent.create({
          data: { name: parentName || "Parent", phone: parentPhone || null },
        });
      }

      await prisma.student.update({
        where: { id: student.id },
        data: { parentId: parent.id },
      });

      userParent = parent.user;
      if (!userParent) {
        const passwordHash = await bcrypt.hash("changeme", 10);
        userParent = await prisma.user.create({
          data: {
            name: parentName || parent.name,
            email: parentEmail || null,
            phone: parentPhone || null,
            password: passwordHash,
            role: "PARENT",
            schoolId,
          },
        });

        await prisma.parent.update({
          where: { id: parent.id },
          data: { userId: userParent.id },
        });
      }

      await prisma.notification.createMany({
        data: [
          {
            parentId: parent.id,
            title: "Welcome",
            message: `Hello ${parent.name}, your child ${student.name} has been added.`,
            type: "INFO",
          },
        ],
        skipDuplicates: true,
      });
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

// 🧩 Update student with parent/user linkage
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const { name, grade, latitude, longitude, busId, schoolId, parentName, parentPhone, parentEmail } = req.body;

    // Step 1: Update basic student info
    const student = await prisma.student.update({
      where: { id },
      data: { name, grade, latitude, longitude, busId, schoolId },
      include: { parent: { include: { user: true } } },
    });

    let parent = student.parent;
    let userParent = parent?.user;

    // Step 2: Handle parent info if provided
    if (parentPhone || parentEmail || parentName) {
      if (!parent) {
        // Create new parent if none exists
        parent = await prisma.parent.create({
          data: { name: parentName || "Parent", phone: parentPhone || null },
        });
        await prisma.student.update({ where: { id }, data: { parentId: parent.id } });
      } else {
        // Update existing parent
        await prisma.parent.update({
          where: { id: parent.id },
          data: { name: parentName || parent.name, phone: parentPhone || parent.phone },
        });
      }

      // Step 3: Ensure User account exists and is linked
      if (!userParent) {
        const passwordHash = await bcrypt.hash("changeme", 10);
        userParent = await prisma.user.create({
          data: {
            name: parentName || parent.name,
            email: parentEmail || null,
            phone: parentPhone || null,
            password: passwordHash,
            role: "PARENT",
            schoolId,
          },
        });

        await prisma.parent.update({ where: { id: parent.id }, data: { userId: userParent.id } });
      } else {
        await prisma.user.update({
          where: { id: userParent.id },
          data: {
            name: parentName || userParent.name,
            email: parentEmail || userParent.email,
            phone: parentPhone || userParent.phone,
          },
        });
      }
    }

    res.json({
      status: "success",
      message: "Student updated successfully",
      student,
      parent,
      userParent,
    });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
};

// 🧩 Delete student
export const deleteStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    await prisma.student.delete({ where: { id } });

    res.json({ status: "success", message: "Student deleted successfully" });
  } catch (error) {
    handleError(res, error, "Failed to delete student");
  }
};
