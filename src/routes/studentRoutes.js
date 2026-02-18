// src/routes/studentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers (KEEP)
========================= */

/**
 * Tenant scoping helper (kept)
 */
function requireTenant(req, res) {
  const tenantId = Number(req.user?.tenantId);
  if (!tenantId || !Number.isFinite(tenantId)) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return tenantId;
}

/**
 * Safer ID parsing (kept)
 */
function parseId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/**
 * Safe number parsing (kept)
 */
function parseFloatSafe(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Prisma error helper (kept)
 */
function prismaError(res, err, fallback = "Server error") {
  console.error("❌ StudentRoutes error:", {
    code: err?.code,
    message: err?.message,
    meta: err?.meta,
  });

  if (err?.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "Duplicate record conflict",
      detail: err?.meta,
    });
  }
  if (err?.code === "P2003") {
    return res.status(400).json({
      success: false,
      message: "Invalid relation reference (foreign key)",
      detail: err?.meta,
    });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  return res.status(500).json({
    success: false,
    message: fallback,
    detail: process.env.NODE_ENV === "production" ? undefined : err?.message,
  });
}

/**
 * Required by schema: User.email is String (NOT nullable).
 * If parentEmail is missing, we generate a safe placeholder email from phone/time.
 * (kept as helper, no functions removed)
 */
function buildSafeParentEmail(parentEmail, parentPhone) {
  const email = parentEmail ? String(parentEmail).trim() : "";
  if (email) return email;

  const phoneDigits = String(parentPhone || "").replace(/\D/g, "");
  const suffix = phoneDigits || String(Date.now());
  return `parent_${suffix}@noemail.local`;
}

/* =========================
   Common include (FIXED casing only)
========================= */
const studentInclude = {
  tenant: true, // ✅ was Tenant
  bus: true,
  parent: { include: { user: true } },
};

/* =========================================================
   STUDENTS (TENANT-SCOPED)
========================================================= */

// ✅ GET all students (tenant scoped)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const students = await prisma.student.findMany({
      where: { tenantId }, // ✅ was TenantId
      include: studentInclude,
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, count: students.length, data: students });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch students");
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
      where: { id: studentId, tenantId }, // ✅ fixed
      include: studentInclude,
    });

    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    return res.json({ success: true, data: student });
  } catch (err) {
    return prismaError(res, err, "Failed to fetch student");
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
      where: { id: busIdNum, tenantId }, // ✅ fixed
      select: { id: true },
    });
    if (!bus) {
      return res.status(400).json({ success: false, message: "Invalid busId (not found for this tenant)" });
    }

    // Find parent by user within same tenant
    let parent = null;

    if (parentPhone || parentEmail) {
      parent = await prisma.parent.findFirst({
        where: {
          tenantId, // ✅ scope parent itself too
          user: {
            tenantId,
            OR: [
              parentPhone ? { phone: String(parentPhone).trim() } : undefined,
              parentEmail ? { email: String(parentEmail).trim() } : undefined,
            ].filter(Boolean),
          },
        },
        include: { user: true },
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      // Create parent user + parent if missing
      if (!parent) {
        const hashed = await bcrypt.hash(String(parentPassword || "changeme"), 10);

        // ✅ FIX: User.email is required by schema => never null
        const safeEmail = buildSafeParentEmail(parentEmail, parentPhone);

        const user = await tx.user.create({
          data: {
            name: String(parentName || "Parent").trim(),
            email: safeEmail, // ✅ was nullable; now always string
            phone: parentPhone ? String(parentPhone).trim() : null,
            password: hashed,
            role: "PARENT",
            tenantId, // ✅ fixed
          },
        });

        parent = await tx.parent.create({
          data: {
            tenantId, // ✅ important
            user: { connect: { id: user.id } },
          },
          include: { user: true },
        });
      }

      // Create student
      const student = await tx.student.create({
        data: {
          name: String(name).trim(),
          grade: String(grade).trim(),
          latitude: latNum,
          longitude: lngNum,
          busId: busIdNum,
          tenantId, // ✅ fixed
          parentId: parent.id,
        },
        include: studentInclude,
      });

      return student;
    });

    return res.status(201).json({ success: true, message: "Student created successfully", data: created });
  } catch (err) {
    return prismaError(res, err, "Failed to create student");
  }
});

// ✅ UPDATE student (tenant scoped + optional parent update)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const studentId = parseId(req.params.id);
    if (!studentId) return res.status(400).json({ success: false, message: "Invalid student id" });

    const { parentName, parentPhone, parentEmail, parentPassword, busId, latitude, longitude, ...rest } = req.body;

    const existing = await prisma.student.findFirst({
      where: { id: studentId, tenantId },
      include: { parent: { include: { user: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Student not found" });

    // If busId provided, ensure it belongs to tenant
    let busIdNum = undefined;
    if (busId !== undefined) {
      busIdNum = parseId(busId);
      if (!busIdNum) return res.status(400).json({ success: false, message: "Invalid busId" });

      const bus = await prisma.bus.findFirst({
        where: { id: busIdNum, tenantId },
        select: { id: true },
      });
      if (!bus) return res.status(400).json({ success: false, message: "Bus not found for this tenant" });
    }

    // lat/lng validation if provided
    const latNum = latitude !== undefined ? parseFloatSafe(latitude) : undefined;
    const lngNum = longitude !== undefined ? parseFloatSafe(longitude) : undefined;
    if (latitude !== undefined && latNum === null) return res.status(400).json({ success: false, message: "Invalid latitude" });
    if (longitude !== undefined && lngNum === null) return res.status(400).json({ success: false, message: "Invalid longitude" });

    const updated = await prisma.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          ...rest,
          ...(busId !== undefined ? { busId: busIdNum } : {}),
          ...(latitude !== undefined ? { latitude: latNum } : {}),
          ...(longitude !== undefined ? { longitude: lngNum } : {}),
          tenantId, // enforce tenant
        },
        include: studentInclude,
      });

      // Update parent/user if parent fields provided
      if (parentName || parentPhone !== undefined || parentEmail !== undefined || parentPassword) {
        let parent = existing.parent;

        // If no parent, create + link
        if (!parent) {
          parent = await tx.parent.create({
            data: { tenantId },
            include: { user: true },
          });
          await tx.student.update({ where: { id: studentId }, data: { parentId: parent.id } });
        }

        // If no user, create one
        if (!parent.user) {
          const hashed = await bcrypt.hash(String(parentPassword || "changeme"), 10);

          // ✅ FIX: User.email is required by schema => never null
          const safeEmail = buildSafeParentEmail(parentEmail, parentPhone);

          const user = await tx.user.create({
            data: {
              name: String(parentName || "Parent").trim(),
              phone: parentPhone ? String(parentPhone).trim() : null,
              email: safeEmail, // ✅ was nullable; now always string
              password: hashed,
              role: "PARENT",
              tenantId,
            },
          });

          await tx.parent.update({
            where: { id: parent.id },
            data: { user: { connect: { id: user.id } } },
          });
        } else {
          const updateData = {};

          if (parentName) updateData.name = String(parentName).trim();
          if (parentPhone !== undefined) updateData.phone = parentPhone ? String(parentPhone).trim() : null;

          // ✅ FIX: email cannot be null in schema
          if (parentEmail !== undefined) {
            updateData.email = buildSafeParentEmail(parentEmail, parentPhone ?? parent.user.phone);
          }

          if (parentPassword) updateData.password = await bcrypt.hash(String(parentPassword), 10);

          // enforce tenant
          updateData.tenantId = tenantId;

          if (Object.keys(updateData).length) {
            await tx.user.update({ where: { id: parent.user.id }, data: updateData });
          }
        }
      }

      return updatedStudent;
    });

    return res.json({ success: true, message: "Student updated successfully", data: updated });
  } catch (err) {
    return prismaError(res, err, "Failed to update student");
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
      where: { id: studentId, tenantId },
      include: { parent: { include: { user: true } } },
    });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    await prisma.$transaction(async (tx) => {
      await tx.student.delete({ where: { id: studentId } });

      const parent = student.parent;
      if (parent) {
        const remaining = await tx.student.count({ where: { parentId: parent.id } });
        if (remaining === 0) {
          if (parent.user) await tx.user.delete({ where: { id: parent.user.id } });
          await tx.parent.delete({ where: { id: parent.id } });
        }
      }
    });

    return res.json({ success: true, message: "Student deleted successfully", studentId });
  } catch (err) {
    return prismaError(res, err, "Failed to delete student");
  }
});

export default router;
