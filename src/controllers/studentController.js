// controllers/studentController.js
import prisma from "../middleware/prisma.js"; // your prisma instance

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

    // Validate required fields
    if (!name || !grade || !schoolId || !parentEmail) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields",
      });
    }

    // 1️⃣ Check if parent exists
    let parent = await prisma.user.findUnique({
      where: {
        email_schoolId: {
          email: parentEmail,
          schoolId: schoolId,
        },
      },
    });

    // 2️⃣ If parent does not exist, create
    if (!parent) {
      parent = await prisma.user.create({
        data: {
          name: parentName,
          phone: parentPhone,
          email: parentEmail,
          role: "PARENT",
          schoolId: schoolId,
        },
      });
    }

    // 3️⃣ Create student and link parent
    const student = await prisma.student.create({
      data: {
        name,
        grade,
        latitude,
        longitude,
        busId,
        schoolId,
        parentId: parent.id,
      },
    });

    return res.status(201).json({
      status: "success",
      message: "Student created successfully",
      student,
      parent,
    });
  } catch (error) {
    console.error("Error creating student:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error",
      detail: error.message,
    });
  }
};
