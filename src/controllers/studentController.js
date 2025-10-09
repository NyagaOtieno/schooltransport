import prisma from "../middleware/prisma.js";

// ✅ Utility: send consistent error responses
const handleError = (res, error, message = "Server error") => {
  console.error(error);
  res.status(500).json({
    status: "error",
    message,
    detail: error.message,
  });
};

// 🧩 Get all students (with school, bus, parent)
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

// 🧩 Get single student
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

// 🧩 Create student first, then parent (linked via studentId)
export const createStudent = async (req, res) => {
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

  if (!name || !grade || !schoolId) {
    return res.status(400).json({
      status: "error",
      message: "Name, grade, and schoolId are required",
    });
  }

  try {
    // ✅ Create the student first
    const student = await prisma.student.create({
      data: { name, grade, latitude, longitude, busId, schoolId },
    });

    let parent = null;

    // ✅ If parent info provided, create and link using a transaction
    if (parentName && parentPhone) {
      const result = await prisma.$transaction(async (tx) => {
        const createdParent = await tx.parent.create({
          data: {
            name: parentName,
            phone: parentPhone,
            students: { connect: { id: student.id } },
          },
        });

        const updatedStudent = await tx.student.update({
          where: { id: student.id },
          data: { parentId: createdParent.id },
          include: { parent: true },
        });

        return { createdParent, updatedStudent };
      });

      parent = result.createdParent;
    }

    res.status(201).json({
      status: "success",
      message: "Student created successfully",
      student,
      parent,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// 🧩 Update student
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const updated = await prisma.student.update({
      where: { id },
      data: req.body,
      include: { parent: true, school: true, bus: true },
    });

    res.json({ status: "success", message: "Student updated", data: updated });
  } catch (error) {
    handleError(res, error, "Failed to update student");
  }
};

// 🧩 Delete student (and unlink parent if exists)
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
