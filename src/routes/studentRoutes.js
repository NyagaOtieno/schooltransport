[3:43 AM, 2/8/2026] NyagaOT: // src/routes/studentRoutes.js
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
  cons…
[3:45 AM, 2/8/2026] NyagaOT: {
    "success": false,
    "message": "Failed to fetch students",
    "detail": "\nInvalid prisma.student.findMany() invocation:\n\n{\n  where: {\n    TenantId: 1,\n    ~~~~\n?   AND?: StudentWhereInput | StudentWhereInput[],\n?   OR?: StudentWhereInput[],\n?   NOT?: StudentWhereInput | StudentWhereInput[],\n?   id?: IntFilter | Int,\n?   name?: StringFilter | String,\n?   grade?: StringFilter | String,\n?   latitude?: FloatFilter | Float,\n?   longitude?: FloatFilter | Float,\n?   busId?: IntFilter | Int,\n?   parentId?: IntNullableFilter | Int | Null,\n?   tenantId?: IntFilter | Int,\n?   userId?: IntNullableFilter | Int | Null,\n?   createdAt?: DateTimeFilter | DateTime,\n?   updatedAt?: DateTimeFilter | DateTime,\n?   bus?: BusRelationFilter | BusWhereI…
[3:48 AM, 2/8/2026] NyagaOT: // src/routes/studentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  const n = Number(tenantId);
  if (!Number.isFinite(n)) {
    res.status(400).json({ success: false, message: "Invalid tenantId in token" });
    return null;
  }
  return n;
}

function parseId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function parseFloatSafe(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

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
      fields: err?.meta?.target,
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

/* =========================
   Prisma include/select
   (✅ use tenant, tenantId — NOT Tenant/TenantId)
========================= */
const studentInclude = {
  tenant: true,
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
      where: { tenantId }, // ✅ fixed
      include: studentInclude, // ✅ fixed include
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

    // Find parent (by user email/phone) within same tenant
    let existingParent = null;
    if (parentPhone || parentEmail) {
      existingParent = await prisma.parent.findFirst({
        where: {
          tenantId, // ✅ fixed
          user: {
            OR: [
              parentPhone ? { phone: String(parentPhone).trim() } : undefined,
              parentEmail ? { email: String(parentEmail).trim() } : undefined,
            ].filter(Boolean),
          },
        },
        include: { user: true },
      });
    }

    const createdStudent = await prisma.$transaction(async (tx) => {
      let parent = existingParent;

      if (!parent) {
        const hashed = await bcrypt.hash(parentPassword || "changeme", 10);

        // ✅ If email missing, generate a safe placeholder to satisfy your schema (email is required)
        const safeEmail =
          parentEmail && String(parentEmail).trim()
            ? String(parentEmail).trim().toLowerCase()
            : parent_${Date.now()}_${Math.floor(Math.random() * 1000)}@placeholder.local;

        const user = await tx.user.create({
          data: {
            name: parentName ? String(parentName).trim() : "Parent",
            email: safeEmail,
            phone: parentPhone ? String(parentPhone).trim() : null,
            password: hashed,
            role: "PARENT",
            tenantId, // ✅ fixed
          },
        });

        parent = await tx.parent.create({
          data: {
            tenantId, // ✅ fixed
            user: { connect: { id: user.id } },
          },
          include: { user: true },
        });
      }

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

    return res.status(201).json({
      success: true,
      message: "Student created successfully",
      data: createdStudent,
    });
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
      where: { id: studentId, tenantId }, // ✅ fixed
      include: { parent: { include: { user: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Student not found" });

    // Validate bus if changing
    let busIdNum;
    if (busId !== undefined) {
      busIdNum = parseId(busId);
      if (!busIdNum) return res.status(400).json({ success: false, message: "Invalid busId" });

      const bus = await prisma.bus.findFirst({
        where: { id: busIdNum, tenantId }, // ✅ fixed
        select: { id: true },
      });
      if (!bus) return res.status(400).json({ success: false, message: "Bus not found for this tenant" });
    }

    // Validate lat/lng if changing
    const latNum = latitude !== undefined ? parseFloatSafe(latitude) : undefined;
    const lngNum = longitude !== undefined ? parseFloatSafe(longitude) : undefined;
    if (latitude !== undefined && latNum === null) return res.status(400).json({ success: false, message: "Invalid latitude" });
    if (longitude !== undefined && lngNum === null) return res.status(400).json({ success: false, message: "Invalid longitude" });

    const updatedStudent = await prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          ...rest,
          ...(busId !== undefined ? { busId: busIdNum } : {}),
          ...(latitude !== undefined ? { latitude: latNum } : {}),
          ...(longitude !== undefined ? { longitude: lngNum } : {}),
          tenantId, // enforce tenant ✅
        },
        include: studentInclude,
      });

      // Parent update path
      if (parentName || parentPhone !== undefined || parentEmail !== undefined || parentPassword) {
        let parent = existing.parent;

        // If missing parent record, create it (tenant-scoped)
        if (!parent) {
          parent = await tx.parent.create({
            data: { tenantId }, // ✅ fixed
            include: { user: true },
          });
          await tx.student.update({ where: { id: studentId }, data: { parentId: parent.id } });
        }

        // Ensure parent has user
        if (!parent.user) {
          const hashed = await bcrypt.hash(parentPassword || "changeme", 10);

          const safeEmail =
            parentEmail && String(parentEmail).trim()
              ? String(parentEmail).trim().toLowerCase()
              : parent_${Date.now()}_${Math.floor(Math.random() * 1000)}@placeholder.local;

          const user = await tx.user.create({
            data: {
              name: parentName ? String(parentName).trim() : "Parent",
              email: safeEmail,
              phone: parentPhone ? String(parentPhone).trim() : null,
              password: hashed,
              role: "PARENT",
              tenantId, // ✅ fixed
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
          if (parentEmail !== undefined) updateData.email = parentEmail ? String(parentEmail).trim().toLowerCase() : null;
          if (parentPassword) updateData.password = await bcrypt.hash(String(parentPassword), 10);

          // keep user tenant correct
          updateData.tenantId = tenantId;

          await tx.user.update({
            where: { id: parent.user.id },
            data: updateData,
          });
        }
      }

      return updated;
    });

    return res.json({ success: true, message: "Student updated successfully", data: updatedStudent });
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
      where: { id: studentId, tenantId }, // ✅ fixed
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