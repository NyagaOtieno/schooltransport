import prisma from "../middleware/prisma.js";

// 🧩 Get all students (with school, bus, parent)
export const getStudents = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { school: true, bus: true, parent: true },
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch students", detail: error.message });
  }
};

// 🧩 Get single student
export const getStudent = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: Number(req.params.id) },
      include: { school: true, bus: true, parent: true },
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });
    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch student", detail: error.message });
  }
};

// 🧩 Create student (and parent if provided)
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
    } = req.body;

    // 1️⃣ Create student first
    const student = await prisma.student.create({
      data: {
        name,
        grade,
        latitude,
        longitude,
        busId,
        schoolId,
      },
    });

    let parent = null;

    // 2️⃣ If parent info is provided, create and link
    if (parentName && parentPhone) {
      parent = await prisma.parent.create({
        data: {
          name: parentName,
          phone: parentPhone,
          students: { connect: { id: student.id } },
        },
      });

      // 3️⃣ Update student with parentId
      await prisma.student.update({
        where: { id: student.id },
        data: { parentId: parent.id },
      });
    }

    res.json({
      status: "success",
      message: "Student created successfully",
      student,
      parent,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
};

// 🧩 Update student
export const updateStudent = async (req, res) => {
  try {
    const updated = await prisma.student.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json({ status: "success", message: "Student updated", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to update student", detail: error.message });
  }
};

// 🧩 Delete student
export const deleteStudent = async (req, res) => {
  try {
    await prisma.student.delete({ where: { id: Number(req.params.id) } });
    res.json({ status: "success", message: "Student deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete student", detail: error.message });
  }
};
