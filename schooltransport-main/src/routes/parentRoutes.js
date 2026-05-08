// src/routes/parentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers (kept)
========================= */
const parseId = (id) => {
  const n = Number(id);
  return Number.isFinite(n) ? n : null; // ✅ safer (no throw)
};

function requireTenant(req, res) {
  const n = Number(req.user?.tenantId);
  if (!n || !Number.isFinite(n)) {
    res.status(403).json({ success: false, message: "Forbidden: token missing tenantId" });
    return null;
  }
  return n;
}

function handleError(res, error, message = "Server error", code = 500) {
  console.error("❌ ParentRoutes error:", {
    message: error?.message,
    code: error?.code,
    meta: error?.meta,
    stack: error?.stack,
  });

  // Prisma known errors
  if (error?.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "Duplicate record conflict",
      detail: error?.meta,
    });
  }
  if (error?.code === "P2003") {
    return res.status(400).json({
      success: false,
      message: "Invalid relation reference (foreign key)",
      detail: error?.meta,
    });
  }
  if (error?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  return res.status(code).json({
    success: false,
    message,
    detail: process.env.NODE_ENV === "production" ? undefined : (error?.message || String(error)),
  });
}

async function hashPassword(pw) {
  return bcrypt.hash(String(pw || "changeme"), 10);
}

/**
 * Parent include (fixed casing)
 * - Parent model has: user, students, notifications
 */
const parentInclude = {
  user: true,
  students: {
    include: {
      bus: true,
      tenant: true, // ✅ was Tenant
    },
  },
  notifications: true,
};

/**
 * Derived assets for a parent:
 * Since Parent has no direct assets relation in your schema,
 * we compute assets from Manifests linked to the parent's students.
 */
async function getParentAssetsByStudentManifests(tenantId, parentId) {
  const assets = await prisma.manifest.findMany({
    where: {
      assetId: { not: null },
      student: {
        parentId,
        tenantId,
      },
    },
    select: {
      asset: {
        select: {
          id: true,
          name: true,
          type: true,
          tag: true,
          tenantId: true,
          busId: true,
          clientId: true,
          deliveryStatus: true,
          deliveredAt: true,
          confirmedAt: true,
          createdAt: true,
          updatedAt: true,
          bus: { select: { id: true, name: true, plateNumber: true } },
          client: { select: { id: true, user: { select: { id: true, name: true, email: true, phone: true } } } },
          tenant: { select: { id: true, name: true, mode: true } },
        },
      },
    },
  });

  // de-duplicate by asset.id
  const map = new Map();
  for (const row of assets) {
    if (row.asset?.id) map.set(row.asset.id, row.asset);
  }
  return Array.from(map.values());
}

/* =========================================================
   PARENTS (TENANT-SCOPED)
   - Parent is a wrapper for a User with role=PARENT
   - Tenant scope enforced using:
     Parent.tenantId AND User.tenantId
========================================================= */

/**
 * GET /api/parents
 * Optional query:
 *  - q=search
 *  - page=1
 *  - limit=20
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      user: {
        role: "PARENT",
        tenantId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    };

    const [count, parents] = await Promise.all([
      prisma.parent.count({ where }),
      prisma.parent.findMany({
        where,
        include: parentInclude,
        orderBy: { id: "desc" },
        skip,
        take: limit,
      }),
    ]);

    // Keep your “assets” feature: return derived assets per parent (optional cost)
    const withAssets = await Promise.all(
      parents.map(async (p) => {
        const assets = await getParentAssetsByStudentManifests(tenantId, p.id);
        return { ...p, assets };
      })
    );

    return res.json({ success: true, page, limit, count, data: withAssets });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parents");
  }
});

/**
 * GET /api/parents/:id
 */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);
    if (!parentId) return res.status(400).json({ success: false, message: "Invalid parent id" });

    const parent = await prisma.parent.findFirst({
      where: {
        id: parentId,
        tenantId,
        user: { role: "PARENT", tenantId },
      },
      include: parentInclude,
    });

    if (!parent) return res.status(404).json({ success: false, message: "Parent not found" });

    const assets = await getParentAssetsByStudentManifests(tenantId, parentId);

    return res.json({ success: true, data: { ...parent, assets } });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parent");
  }
});

/**
 * POST /api/parents
 * Body: { name, phone, email?, password? }
 * tenant comes from token only.
 */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const { name, email, phone, password } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: "name and phone are required" });
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? String(phone).trim() : null;

    // Unique within tenant
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

    if (existing) {
      return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: String(name).trim(),
          email: cleanEmail,
          phone: cleanPhone,
          password: await hashPassword(password),
          role: "PARENT",
          tenantId,
        },
      });

      const parent = await tx.parent.create({
        data: {
          tenantId,
          user: { connect: { id: user.id } },
        },
        include: parentInclude,
      });

      return parent;
    });

    return res.status(201).json({ success: true, data: { ...created, assets: [] } });
  } catch (error) {
    return handleError(res, error, "Failed to create parent");
  }
});

/**
 * PUT /api/parents/:id
 * Body: { name?, phone?, email?, password? }
 */
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

    // uniqueness check
    if (cleanEmail !== undefined || cleanPhone !== undefined) {
      const conflict = await prisma.user.findFirst({
        where: {
          tenantId,
          NOT: { id: parent.user.id },
          OR: [
            cleanEmail !== undefined && cleanEmail !== null ? { email: cleanEmail } : undefined,
            cleanPhone !== undefined && cleanPhone !== null ? { phone: cleanPhone } : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      });

      if (conflict) {
        return res.status(409).json({ success: false, message: "Email or phone already exists in this tenant" });
      }
    }

    await prisma.user.update({
      where: { id: parent.user.id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(cleanEmail !== undefined ? { email: cleanEmail } : {}),
        ...(cleanPhone !== undefined ? { phone: cleanPhone } : {}),
        ...(password ? { password: await bcrypt.hash(String(password), 10) } : {}),
        tenantId, // enforce tenant safety
        role: "PARENT",
      },
    });

    const refreshed = await prisma.parent.findUnique({
      where: { id: parentId },
      include: parentInclude,
    });

    const assets = await getParentAssetsByStudentManifests(tenantId, parentId);

    return res.json({ success: true, message: "Parent updated", data: { ...refreshed, assets } });
  } catch (error) {
    return handleError(res, error, "Failed to update parent");
  }
});

/**
 * DELETE /api/parents/:id
 * - tenant-scoped
 * - deletes Parent then User (transaction)
 * - blocks delete if students exist
 */
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

    if (studentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete parent. Linked student exist: ${studentCount}`,
      });
    }

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