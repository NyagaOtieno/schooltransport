// src/routes/studentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Tenant scoping helper
 */
function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return Number(tenantId);
}

/**
 * Safer ID parsing (returns null instead of throwing)
 */
function parseId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/**
 * Safe number parsing (for latitude/longitude that may come as strings)
 */
function parseFloatSafe(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Common include
 */
const studentInclude = {
  Tenant: true,
  bus: true,
  parent: { include: { user: true } },
};

/**
 * Prisma error helper
 */
function prismaError(res, err, fallback = "Server error") {
  console.error(err);

  // Prisma known errors
  if (err?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Duplicate record conflict", detail: err?.meta });
  }
  if (err?.code === "P2003") {
    return res.status(400).json({ success: false, message: "Invalid relation reference (foreign key)", detail: err?.meta });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  return res.status(500).json({ success: false, message: fallback, detail: err?.message });
}

/* =========================================================
   STUDENTS (TENANT-SCOPED)
   ========================================================= */

// ✅ GET all students (tenant scoped)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const students = await prisma.student.findMany({
      where: { TenantId: tenantId },
      include: studentInclude,
      orderBy: { id: "desc" },
    });

    res.json({ success: true, count: students.length, data: students });
  } catch (err) {
    prismaError(res, err, "Failed to fetch students");
  }
});

// ✅ GET student by ID (tenant scoped)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const studentId = parseId(req.params.id);
    if (!studentId) return res.status(400).json({ success: false, message: "Invalid student id" });

    const student = await prisma.student.findFirst({
      where: { id: studentId, TenantId: tenantId },
      include: studentInclude,
    });

    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    res.json({ success: true, data: student });
  } catch (err) {
    prismaError(res, err, "Failed to fetch student");
  }
});

// ✅ CREATE student (tenant scoped, parent auto-create if needed)
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const {
      name,
      grade,
      latitude,
      longitude,
      busId,
      // parent info (at least one needed)
      parentName,
      parentPhone,
      parentEmail,
      parentPassword,
    } = req.body;

    const busIdNum = parseId(busId);
    const latNum = parseFloatSafe(latitude);
    const lngNum = parseFloatSafe(longitude);

    if (!name || !grade) {
      return res.status(400).json({ success: false, message: "name and grade are required" });
    }

    if (!busIdNum) {
      return res.status(400).json({ success: false, message: "Valid busId is required" });
    }

    if (latNum === null || lngNum === null) {
      return res.status(400).json({ success: false, message: "Valid latitude and longitude are required" });
    }

    if (!parentName && !parentPhone && !parentEmail) {
      return res.status(400).json({
        success: false,
        message: "Parent info required: provide at least parentName, parentPhone or parentEmail",
      });
    }

    // Ensure bus belongs to this tenant
    const bus = await prisma.bus.findFirst({
      where: { id: busIdNum, TenantId: tenantId },
      select: { id: true },
    });
    if (!bus) {
      return res.status(400).json({ success: false, message: "Invalid busId (not found for this tenant)" });
    }

    // Find parent by user within same tenant (scope by User.TenantId)
    let parent = null;
    if (parentPhone || parentEmail) {
      parent = await prisma.parent.findFirst({
        where: {
          user: {
            TenantId: tenantId,
            OR: [
              parentPhone ? { phone: parentPhone } : undefined,
              parentEmail ? { email: parentEmail } : undefined,
            ].filter(Boolean),
          },
        },
        include: { user: true },
      });
    }

    // Transaction: create (optional user+parent) + student atomically
    const result = await prisma.$transaction(async (tx) => {
      // Create parent user + parent if missing
      if (!parent) {
        const hashed = await bcrypt.hash(parentPassword || "changeme", 10);

        const user = await tx.user.create({
          data: {
            name: parentName || "Parent",
            email: parentEmail,
            phone: parentPhone ?? null,
            password: hashed,
            role: "PARENT",
            TenantId: tenantId,
          },
        });

        parent = await tx.parent.create({
          data: { user: { connect: { id: user.id } } },
          include: { user: true },
        });
      }

      // Create student
      const student = await tx.student.create({
        data: {
          name: name.toString().trim(),
          grade: grade.toString().trim(),
          latitude: latNum,
          longitude: lngNum,
          busId: busIdNum,
          TenantId: tenantId,
          parentId: parent.id,
        },
        include: studentInclude,
      });

      return student;
    });

    res.status(201).json({ success: true, message: "Student created successfully", data: result });
  } catch (err) {
    prismaError(res, err, "Failed to create student");
  }
});

// ✅ UPDATE student (tenant scoped + optional parent update)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const studentId = parseId(req.params.id);
    if (!studentId) return res.status(400).json({ success: false, message: "Invalid student id" });

    const {
      parentName,
      parentPhone,
      parentEmail,
      parentPassword,
      busId,
      latitude,
      longitude,
      ...rest
    } = req.body;

    const existing = await prisma.student.findFirst({
      where: { id: studentId, TenantId: tenantId },
      include: { parent: { include: { user: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Student not found" });

    // If busId provided, ensure it belongs to tenant
    let busIdNum;
    if (busId !== undefined) {
      busIdNum = parseId(busId);
      if (!busIdNum) return res.status(400).json({ success: false, message: "Invalid busId" });

      const bus = await prisma.bus.findFirst({
        where: { id: busIdNum, TenantId: tenantId },
        select: { id: true },
      });
      if (!bus) return res.status(400).json({ success: false, message: "Bus not found for this tenant" });
    }

    // lat/lng if provided must be valid
    const latNum = latitude !== undefined ? parseFloatSafe(latitude) : undefined;
    const lngNum = longitude !== undefined ? parseFloatSafe(longitude) : undefined;
    if (latitude !== undefined && latNum === null) return res.status(400).json({ success: false, message: "Invalid latitude" });
    if (longitude !== undefined && lngNum === null) return res.status(400).json({ success: false, message: "Invalid longitude" });

    const updated = await prisma.$transaction(async (tx) => {
      // Update student first
      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          ...rest,
          ...(busId !== undefined ? { busId: busIdNum } : {}),
          ...(latitude !== undefined ? { latitude: latNum } : {}),
          ...(longitude !== undefined ? { longitude: lngNum } : {}),
          TenantId: tenantId, // enforce tenant (extra safety)
        },
        include: studentInclude,
      });

      // Update parent/user if parent fields provided
      if (parentName || parentPhone || parentEmail || parentPassword) {
        let parent = existing.parent;

        // If no parent record, create one + link
        if (!parent) {
          parent = await tx.parent.create({ include: { user: true } });
          await tx.student.update({ where: { id: studentId }, data: { parentId: parent.id } });
        }

        // If parent has no user, create one
        if (!parent.user) {
          const hashed = await bcrypt.hash(parentPassword || "changeme", 10);
          const user = await tx.user.create({
            data: {
              name: parentName || "Parent",
              phone: parentPhone ?? null,
              email: parentEmail,
              password: hashed,
              role: "PARENT",
              TenantId: tenantId,
            },
          });

          await tx.parent.update({
            where: { id: parent.id },
            data: { user: { connect: { id: user.id } } },
          });
        } else {
          const updateData = {};
          if (parentName) updateData.name = parentName;
          if (parentPhone !== undefined) updateData.phone = parentPhone || null;
          if (parentEmail !== undefined) updateData.email = parentEmail || null;
          if (parentPassword) updateData.password = await bcrypt.hash(parentPassword, 10);

          // Optional: enforce tenant on user (recommended)
          updateData.TenantId = tenantId;

          if (Object.keys(updateData).length) {
            await tx.user.update({ where: { id: parent.user.id }, data: updateData });
          }
        }
      }

      return updatedStudent;
    });

    res.json({ success: true, message: "Student updated successfully", data: updated });
  } catch (err) {
    prismaError(res, err, "Failed to update student");
  }
});

// ✅ DELETE student (tenant scoped + cleanup parent/user if no students left)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const studentId = parseId(req.params.id);
    if (!studentId) return res.status(400).json({ success: false, message: "Invalid student id" });

    const student = await prisma.student.findFirst({
      where: { id: studentId, TenantId: tenantId },
      include: { parent: { include: { user: true } } },
    });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    await prisma.$transaction(async (tx) => {
      // delete student
      await tx.student.delete({ where: { id: studentId } });

      // cleanup parent/user if no remaining students
      const parent = student.parent;
      if (parent) {
        const remaining = await tx.student.count({ where: { parentId: parent.id } });
        if (remaining === 0) {
          if (parent.user) await tx.user.delete({ where: { id: parent.user.id } });
          await tx.parent.delete({ where: { id: parent.id } });
        }
      }
    });

    res.json({ success: true, message: "Student deleted successfully", studentId });
  } catch (err) {
    prismaError(res, err, "Failed to delete student");
  }
});

export default router;
