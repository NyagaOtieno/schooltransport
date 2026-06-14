// src/routes/parentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* ── Helpers ──────────────────────────────────────────────── */
const parseId = (id) => { const n = Number(id); return Number.isFinite(n) ? n : null; };

function requireTenant(req, res) {
  const n = Number(req.user?.tenantId);
  if (!n || !Number.isFinite(n)) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return n;
}

function handleError(res, error, message = "Server error", code = 500) {
  console.error("❌ ParentRoutes error:", { message: error?.message, code: error?.code });
  if (error?.code === "P2002") return res.status(409).json({ success: false, message: "Duplicate record conflict" });
  if (error?.code === "P2003") return res.status(400).json({ success: false, message: "Invalid relation reference" });
  if (error?.code === "P2025") return res.status(404).json({ success: false, message: "Record not found" });
  return res.status(code).json({ success: false, message });
}

async function hashPassword(pw) { return bcrypt.hash(String(pw || "changeme"), 10); }

const parentInclude = {
  user:          true,
  students:      { include: { bus: true, tenant: true } },
  notifications: true,
};

/* ============================================================
   GET /api/parents/me
   Returns the Parent profile for the authenticated PARENT user.
   Used by ParentScreen to get parentId + wallet.
============================================================ */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId   = req.user?.id;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parent = await prisma.parent.findFirst({
      where: { userId, tenantId },
      include: {
        user:    { select: { id: true, name: true, email: true, phone: true, role: true } },
        wallet:  { select: { id: true, balance: true } },
        students: {
          include: {
            bus: { select: { id: true, name: true, plateNumber: true, route: true } },
          },
        },
      },
    });

    if (!parent) {
      return res.status(404).json({ success: false, message: "Parent profile not found." });
    }

    return res.status(200).json({ success: true, data: parent });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parent profile");
  }
});

/* ============================================================
   GET /api/parents/me/students
   Returns all students linked to the authenticated parent.
   This is what ParentScreen uses to populate the child selector.
   Response includes: id, name, grade, busId, bus details.
============================================================ */
router.get("/me/students", authMiddleware, async (req, res) => {
  try {
    const userId   = req.user?.id;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    // Find parent for this user
    const parent = await prisma.parent.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });

    if (!parent) {
      return res.status(404).json({ success: false, message: "Parent profile not found." });
    }

    // Fetch all students linked to this parent
    const students = await prisma.student.findMany({
      where:   { parentId: parent.id, tenantId },
      orderBy: { name: "asc" },
      select: {
        id:        true,
        name:      true,
        grade:     true,
        latitude:  true,
        longitude: true,
        busId:     true,
        parentId:  true,
        tenantId:  true,
        bus: {
          select: {
            id:          true,
            name:        true,
            plateNumber: true,
            route:       true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      count:   students.length,
      data:    students,
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch students");
  }
});

/* ============================================================
   GET /api/parents — list all parents (ADMIN use)
============================================================ */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const q     = String(req.query.q || "").trim();
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip  = (page - 1) * limit;

    const where = {
      tenantId,
      user: {
        role: "PARENT", tenantId,
        ...(q ? { OR: [
          { name:  { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ] } : {}),
      },
    };

    const [count, parents] = await Promise.all([
      prisma.parent.count({ where }),
      prisma.parent.findMany({ where, include: parentInclude, orderBy: { id: "desc" }, skip, take: limit }),
    ]);

    return res.json({ success: true, page, limit, count, data: parents });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parents");
  }
});

/* ============================================================
   GET /api/parents/:id
============================================================ */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);
    if (!parentId) return res.status(400).json({ success: false, message: "Invalid parent id" });

    const parent = await prisma.parent.findFirst({
      where:   { id: parentId, tenantId, user: { role: "PARENT", tenantId } },
      include: parentInclude,
    });

    if (!parent) return res.status(404).json({ success: false, message: "Parent not found" });

    return res.json({ success: true, data: parent });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parent");
  }
});

/* ============================================================
   POST /api/parents
============================================================ */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const { name, email, phone, password } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, message: "name and phone are required" });

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? String(phone).trim() : null;

    const existing = await prisma.user.findFirst({
      where: {
        tenantId,
        OR: [
          cleanEmail ? { email: cleanEmail } : undefined,
          cleanPhone ? { phone: cleanPhone } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });

    if (existing) return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: String(name).trim(), email: cleanEmail, phone: cleanPhone, password: await hashPassword(password), role: "PARENT", tenantId },
      });
      return tx.parent.create({
        data: { tenantId, user: { connect: { id: user.id } } },
        include: parentInclude,
      });
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return handleError(res, error, "Failed to create parent");
  }
});

/* ============================================================
   PUT /api/parents/:id
============================================================ */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);
    if (!parentId) return res.status(400).json({ success: false, message: "Invalid parent id" });

    const { name, email, phone, password } = req.body;

    const parent = await prisma.parent.findFirst({
      where: { id: parentId, tenantId, user: { role: "PARENT", tenantId } },
      include: { user: true },
    });
    if (!parent?.user) return res.status(404).json({ success: false, message: "Parent not found" });

    const cleanEmail = email !== undefined ? (email ? String(email).trim().toLowerCase() : null) : undefined;
    const cleanPhone = phone !== undefined ? (phone ? String(phone).trim() : null) : undefined;

    await prisma.user.update({
      where: { id: parent.user.id },
      data: {
        ...(name        !== undefined ? { name: String(name).trim() } : {}),
        ...(cleanEmail  !== undefined ? { email: cleanEmail }         : {}),
        ...(cleanPhone  !== undefined ? { phone: cleanPhone }         : {}),
        ...(password                  ? { password: await bcrypt.hash(String(password), 10) } : {}),
        tenantId, role: "PARENT",
      },
    });

    const refreshed = await prisma.parent.findUnique({ where: { id: parentId }, include: parentInclude });
    return res.json({ success: true, message: "Parent updated", data: refreshed });
  } catch (error) {
    return handleError(res, error, "Failed to update parent");
  }
});

/* ============================================================
   DELETE /api/parents/:id
============================================================ */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);
    if (!parentId) return res.status(400).json({ success: false, message: "Invalid parent id" });

    const parent = await prisma.parent.findFirst({
      where: { id: parentId, tenantId, user: { role: "PARENT", tenantId } },
      include: { user: true },
    });
    if (!parent?.user) return res.status(404).json({ success: false, message: "Parent not found" });

    const studentCount = await prisma.student.count({ where: { parentId, tenantId } });
    if (studentCount > 0) return res.status(400).json({ success: false, message: `Cannot delete: ${studentCount} linked students` });

    await prisma.$transaction(async (tx) => {
      await tx.parent.delete({ where: { id: parentId } });
      await tx.user.delete({ where: { id: parent.user.id } });
    });

    return res.json({ success: true, message: "Parent deleted" });
  } catch (error) {
    return handleError(res, error, "Failed to delete parent");
  }
});

export default router;