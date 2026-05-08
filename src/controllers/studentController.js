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

// ✅ Match your schema (Tenant, not School)
const studentInclude = {
  tenant: true,
  bus: true,
  parent: { include: { user: true } },
};

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
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid student ID" });
    }

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
// Create student (safe parent-user linkage, reuse existing parent)
// Schema-correct: tenantId everywhere, email required, Parent requires tenantId
// -----------------------------
export const createStudent = async (req, res) => {
  try {
    const {
      name,
      grade,
      latitude,
      longitude,
      busId,
      schoolId, // incoming alias
      tenantId: tenantIdFromBody, // allow both
      parentId,
      parentName,
      parentPhone,
      parentEmail,
    } = req.body;

    const tenantId = Number(tenantIdFromBody ?? schoolId);

    if (!name || !grade || Number.isNaN(tenantId)) {
      return res.status(400).json({
        status: "error",
        message: "Name, grade, and schoolId/tenantId are required",
      });
    }

    if (latitude == null || longitude == null || busId == null) {
      return res.status(400).json({
        status: "error",
        message: "latitude, longitude and busId are required",
      });
    }

    // ✅ Ensure bus belongs to same tenant (prevents cross-tenant linking)
    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), tenantId },
      select: { id: true },
    });

    if (!bus) {
      return res.status(400).json({
        status: "error",
        message: "Invalid busId for this tenant",
      });
    }

    let parent = null;
    let userParent = null;

    // -----------------------------
    // A) If parentId provided, connect it (preferred)
    // -----------------------------
    if (parentId != null && parentId !== "") {
      parent = await prisma.parent.findFirst({
        where: { id: Number(parentId), tenantId },
        include: { user: true },
      });

      if (!parent) {
        return res.status(400).json({
          status: "error",
          message: "Invalid parentId for this tenant",
        });
      }

      userParent = parent.user ?? null;
    }

    // -----------------------------
    // B) Otherwise find/create by parentPhone/email
    // -----------------------------
    if (!parent) {
      // Require at least one identifier for parent creation
      if (!parentPhone && !parentEmail && !parentName) {
        return res.status(400).json({
          status: "error",
          message: "Parent info required: provide at least parentName, parentPhone or parentEmail",
        });
      }

      // Find existing parent via user's unique keys within tenant
      if (parentPhone || parentEmail) {
        parent = await prisma.parent.findFirst({
          where: {
            tenantId,
            OR: [
              parentPhone ? { user: { phone: parentPhone } } : undefined,
              parentEmail ? { user: { email: parentEmail } } : undefined,
            ].filter(Boolean),
          },
          include: { user: true },
        });

        if (parent?.user) {
          userParent = parent.user;

          // Update user with latest provided values (but keep email non-null)
          const safeEmail =
            (parentEmail && String(parentEmail).trim()) ||
            userParent.email ||
            `parent_${String(parentPhone || userParent.phone || "unknown").replace(/\D/g, "")}@noemail.local`;

          await prisma.user.update({
            where: { id: userParent.id },
            data: {
              name: parentName || userParent.name,
              phone: parentPhone || userParent.phone,
              email: safeEmail,
            },
          });
        }
      }

      // Create parent + user if none found
      if (!parent) {
        // ✅ email required by schema → never null
        const safeEmail =
          (parentEmail && String(parentEmail).trim()) ||
          `parent_${String(parentPhone || Date.now()).replace(/\D/g, "")}@noemail.local`;

        const passwordHash = await bcrypt.hash("changeme", 10);

        userParent = await prisma.user.create({
          data: {
            name: parentName || "Parent",
            phone: parentPhone || null,
            email: safeEmail,
            password: passwordHash,
            role: "PARENT",
            tenantId, // ✅ correct field
          },
        });

        // ✅ Parent requires tenantId
        parent = await prisma.parent.create({
          data: {
            tenantId,
            userId: userParent.id,
          },
          include: { user: true },
        });
      }
    }

    // -----------------------------
    // Create student
    // -----------------------------
    const student = await prisma.student.create({
      data: {
        name,
        grade,
        latitude: Number(latitude),
        longitude: Number(longitude),
        busId: Number(busId),
        tenantId,          // ✅ correct field
        parentId: parent?.id ?? null,
      },
      include: studentInclude,
    });

    res.status(201).json({
      status: "success",
      message: "Student created successfully",
      data: student,
    });
  } catch (error) {
    handleError(res, error, "Failed to create student");
  }
};

// -----------------------------
// Update student + parent-user linkage (schema-correct)
// -----------------------------
export const updateStudent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

    const { parentName, parentPhone, parentEmail, parentId, schoolId, tenantId: tenantIdFromBody, ...studentData } = req.body;

    const student = await prisma.student.findUnique({
      where: { id },
      include: { parent: { include: { user: true } } },
    });

    if (!student) return res.status(404).json({ status: "error", message: "Student not found" });

    const tenantId = student.tenantId ?? Number(tenantIdFromBody ?? schoolId);

    // Update basic student fields (don’t allow tenantId changes here)
    const updatedStudent = await prisma.student.update({
      where: { id },
      data: {
        ...studentData,
        ...(studentData.busId != null ? { busId: Number(studentData.busId) } : {}),
        ...(studentData.latitude != null ? { latitude: Number(studentData.latitude) } : {}),
        ...(studentData.longitude != null ? { longitude: Number(studentData.longitude) } : {}),
      },
      include: studentInclude,
    });

    // If parentId provided, connect directly (must match tenant)
    if (parentId != null && parentId !== "") {
      const p = await prisma.parent.findFirst({ where: { id: Number(parentId), tenantId } });
      if (!p) {
        return res.status(400).json({ status: "error", message: "Invalid parentId for this tenant" });
      }
      await prisma.student.update({ where: { id }, data: { parentId: p.id } });

      return res.json({ status: "success", message: "Student updated successfully", data: updatedStudent });
    }

    // Otherwise update/create parent user if any parent fields provided
    if (parentPhone || parentEmail || parentName) {
      let parent = student.parent;
      let userParent = parent?.user;

      if (!parent) {
        parent = await prisma.parent.create({ data: { tenantId } });
        await prisma.student.update({ where: { id }, data: { parentId: parent.id } });
      }

      const safeEmail =
        (parentEmail && String(parentEmail).trim()) ||
        userParent?.email ||
        `parent_${String(parentPhone || userParent?.phone || Date.now()).replace(/\D/g, "")}@noemail.local`;

      if (!userParent) {
        const passwordHash = await bcrypt.hash("changeme", 10);
        userParent = await prisma.user.create({
          data: {
            name: parentName || "Parent",
            phone: parentPhone || null,
            email: safeEmail,
            password: passwordHash,
            role: "PARENT",
            tenantId,
          },
        });
        await prisma.parent.update({ where: { id: parent.id }, data: { userId: userParent.id } });
      } else {
        await prisma.user.update({
          where: { id: userParent.id },
          data: {
            name: parentName || userParent.name,
            phone: parentPhone || userParent.phone,
            email: safeEmail,
          },
        });
      }
    }

    res.json({ status: "success", message: "Student updated successfully", data: updatedStudent });
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
    if (Number.isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid student ID" });

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
