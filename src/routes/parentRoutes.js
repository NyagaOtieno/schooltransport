// src/routes/parentRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
const parseId = (id) => {
  const n = Number(id);
  if (!Number.isFinite(n)) throw new Error("Invalid ID");
  return n;
};

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

function handleError(res, error, message = "Server error", code = 500) {
  console.error(error);
  return res.status(code).json({
    success: false,
    message,
    detail: error?.message || String(error),
  });
}

async function hashPassword(pw) {
  return bcrypt.hash(pw || "changeme", 10);
}

// common includes
const parentInclude = {
  user: true,
  students: {
    include: {
      bus: true,
      Tenant: true, // ✅ tenant instead of school
    },
  },
  assets: {
    include: {
      bus: true,
      Tenant: true,
    },
  },
};

/* =========================================================
   PARENTS (TENANT-SCOPED)
   - Parent is a wrapper for a User with role=PARENT
   - Tenant scope enforced via Parent.user.TenantId
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
      user: {
        role: "PARENT",
        TenantId: tenantId,
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

    return res.json({
      success: true,
      page,
      limit,
      count,
      data: parents,
    });
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

    const parent = await prisma.parent.findFirst({
      where: {
        id: parentId,
        user: { role: "PARENT", TenantId: tenantId },
      },
      include: parentInclude,
    });

    if (!parent) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }

    return res.json({ success: true, data: parent });
  } catch (error) {
    return handleError(res, error, "Failed to fetch parent");
  }
});

/**
 * POST /api/parents
 * Body: { name, phone, email?, password? }
 * NOTE: tenant comes from token only.
 */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const { name, email, phone, password } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: "name and phone are required",
      });
    }

    // Unique within this tenant
    const existing = await prisma.user.findFirst({
      where: {
        TenantId: tenantId,
        OR: [
          email ? { email: String(email).trim().toLowerCase() } : undefined,
          phone ? { phone: String(phone).trim() } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already exists in this tenant",
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: String(name).trim(),
          email: email ? String(email).trim().toLowerCase() : null,
          phone: String(phone).trim(),
          password: await hashPassword(password),
          role: "PARENT",
          TenantId: tenantId,
        },
      });

      const parent = await tx.parent.create({
        data: { userId: user.id },
        include: parentInclude,
      });

      return parent;
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return handleError(res, error, "Failed to create parent");
  }
});

/**
 * PUT /api/parents/:id
 * Body: { name?, phone?, email?, password? }
 * NOTE: tenant comes from token only.
 */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);
    const { name, email, phone, password } = req.body;

    const parent = await prisma.parent.findFirst({
      where: { id: parentId, user: { role: "PARENT", TenantId: tenantId } },
      include: { user: true },
    });

    if (!parent || !parent.user) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }

    // Enforce uniqueness within tenant for email/phone (excluding current user)
    if (email || phone) {
      const conflict = await prisma.user.findFirst({
        where: {
          TenantId: tenantId,
          NOT: { id: parent.user.id },
          OR: [
            email ? { email: String(email).trim().toLowerCase() } : undefined,
            phone ? { phone: String(phone).trim() } : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      });

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "Email or phone already exists in this tenant",
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: parent.user.id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(email !== undefined ? { email: email ? String(email).trim().toLowerCase() : null } : {}),
        ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
        ...(password ? { password: await bcrypt.hash(password, 10) } : {}),
        // ✅ Force tenant safety (never change tenant)
        TenantId: tenantId,
        role: "PARENT",
      },
    });

    const refreshed = await prisma.parent.findUnique({
      where: { id: parentId },
      include: parentInclude,
    });

    return res.json({
      success: true,
      message: "Parent updated",
      data: { ...refreshed, user: updatedUser },
    });
  } catch (error) {
    return handleError(res, error, "Failed to update parent");
  }
});

/**
 * DELETE /api/parents/:id
 * - tenant-scoped
 * - deletes Parent then User (transaction)
 */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parentId = parseId(req.params.id);

    const parent = await prisma.parent.findFirst({
      where: { id: parentId, user: { role: "PARENT", TenantId: tenantId } },
      include: { user: true },
    });

    if (!parent || !parent.user) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }

    // Safety: if there are students/assets linked, you can either block delete or allow.
    // Here: block if still linked.
    const [studentCount, assetCount] = await Promise.all([
      prisma.student.count({ where: { parentId: parentId } }),
      prisma.asset.count({ where: { parentId: parentId } }),
    ]);

    if (studentCount > 0 || assetCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete parent. Linked records exist: students=${studentCount}, assets=${assetCount}`,
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
