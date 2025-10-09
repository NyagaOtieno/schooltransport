import prisma from "../middleware/prisma.js";

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
    const { name, grade, latitude, longitude, busId, schoolId, parentName, parentPhone } = req.body;

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

    // Step 2: Handle parent if phone is provided
    if (parentPhone) {
      // Try to find existing parent by phone
      parent = await prisma.parent.findFirst({ where: { user: { phone: parentPhone } } });

      // Create parent if not exists
      if (!parent) {
        parent = await prisma.parent.create({
          data: { name: parentName || "Parent" },
        });
      }

      // Step 3: Connect student to parent
      await prisma.student.update({
        where: { id: student.id },
        data: { parentId: parent.id },
      });

      // Step 4: Handle User linkage
      userParent = await prisma.user.findFirst({
        where: { phone: parentPhone, role: "PARENT" },
      });

      if (!userParent) {
        userParent = await prisma.user.create({
          data: {
            name: parentName || parent.name,
            phone: parentPhone,
            password: "changeme", // default password
            schoolId,
            role: "PARENT",
          },
        });

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

// 🧩 Update student and handle parent info/User linkage
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const { parentName, parentPhone, ...studentData } = req.body;

    // Step 1: Fetch student with parent/user
    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    // Step 2: Update student info
    const updatedStudent = await prisma.student.update({
      where: { id },
      data: studentData,
    });

    // Step 3: Handle parent update
    if (parentPhone) {
      let parent = student.parent;
      let userParent = parent?.user;

      // Update existing parent or create new
      if (!parent) {
        parent = await prisma.parent.create({
          data: { name: parentName || "Parent" },
        });
      } else {
        parent = await prisma.parent.update({
          where: { id: parent.id },
          data: { name: parentName || parent.name },
        });
      }

      // Link student to parent if not already linked
      if (updatedStudent.parentId !== parent.id) {
        await prisma.student.update({
          where: { id },
          data: { parentId: parent.id },
        });
      }

      // Update or create User
      if (!userParent) {
        userParent = await prisma.user.create({
          data: {
            name: parentName || parent.name,
            phone: parentPhone,
            password: "changeme",
            schoolId: student.schoolId,
            role: "PARENT",
          },
        });

        await prisma.parent.update({
          where: { id: parent.id },
          data: { userId: userParent.id },
        });
      } else {
        userParent = await prisma.user.update({
          where: { id: userParent.id },
          data: {
            name: parentName || parent.name,
            phone: parentPhone,
          },
        });
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

// 🧩 Delete student, optionally clean up parent/user
export const deleteStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ status: "error", message: "Invalid student ID" });

    // Fetch student with parent and user
    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student)
      return res.status(404).json({ status: "error", message: "Student not found" });

    const parent = student.parent;
    const userParent = parent?.user;

    // Delete student
    await prisma.student.delete({ where: { id } });

    // Clean up parent and user if no other students remain
    if (parent) {
      const remainingStudents = await prisma.student.count({
        where: { parentId: parent.id },
      });

      if (remainingStudents === 0) {
        if (userParent) await prisma.user.delete({ where: { id: userParent.id } });
        await prisma.parent.delete({ where: { id: parent.id } });
      }
    }

    res.json({
      status: "success",
      message: "Student deleted successfully",
      studentId: id,
    });
  } catch (error) {
    handleError(res, error, "Failed to delete student");
  }
};
