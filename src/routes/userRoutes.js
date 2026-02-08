// src/routes/userRoutes.js
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
  if (tenantId === undefined || tenantId === null || tenantId === "") {
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

function parseId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ok(res, payload) {
  return res.status(200).json({ success: true, ...payload });
}

function fail(res, code, message, detail) {
  return res.status(code).json({ success: false, message, ...(detail ? { detail } : {}) });
}

// consistent default password
async function hashPassword(password) {
  const pwd = password && String(password).trim() ? String(password) : "changeme";
  return bcrypt.hash(pwd, 10);
}

/**
 * Keep response safe: never return password fields
 * ✅ Use correct Prisma field names: tenantId, tenant
 */
const userSelectSafe = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
  tenant: { select: { id: true, name: true, mode: true, logoUrl: true } },
  parent: { select: { id: true } },
  client: { select: { id: true } },
};

/* =========================
   Routes (JWT required)
========================= */

router.use(authMiddleware);

/**
 * GET /api/users
 * Tenant-scoped list (supports ?q= search + ?role= filter)
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const q = (req.query.q ?? "").toString().trim();
    const role = (req.query.role ?? "").toString().trim().toUpperCase();

    const where = {
      tenantId,
      ...(role ? { role } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      select: userSelectSafe,
      orderBy: { createdAt: "desc" },
    });

    return ok(res, { count: users.length, data: users });
  } catch (err) {
    console.error("❌ users list error:", err);
    return fail(res, 500, "Server error fetching users", err?.message);
  }
});

/**
 * GET /api/users/:id
 * Tenant-scoped
 */
router.get("/:id", async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const userId = parseId(req.params.id);
    if (!userId) return fail(res, 400, "Invalid user ID");

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: userSelectSafe,
    });

    if (!user) return fail(res, 404, "User not found");
    return ok(res, { data: user });
  } catch (err) {
    console.error("❌ user get error:", err);
    return fail(res, 500, "Server error fetching user", err?.message);
  }
});

/**
 * POST /api/users
 * Create user (tenantId comes ONLY from token)
 * Body: { name, email, phone, role, password }
 */
router.post("/", async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const name = (req.body.name ?? "").toString().trim();
    const email = (req.body.email ?? "").toString().trim().toLowerCase();
    const phone = (req.body.phone ?? "").toString().trim() || null;
    const role = (req.body.role ?? "PARENT").toString().trim().toUpperCase();
    const password = req.body.password;

    if (!name) return fail(res, 400, "name is required");
    if (!email && !phone) return fail(res, 400, "Provide at least email or phone");

    // uniqueness check within tenant
    const conflict = await prisma.user.findFirst({
      where: {
        tenantId,
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });

    if (conflict) {
      return fail(res, 409, "Email or phone already exists for this tenant");
    }

    const newUser = await prisma.user.create({
      data: {
        name,
        email: email || null,
        phone,
        role,
        password: await hashPassword(password),
        tenantId,
      },
      select: userSelectSafe,
    });

    return res.status(201).json({ success: true, message: "User created", data: newUser });
  } catch (err) {
    console.error("❌ user create error:", err);
    if (err?.code === "P2002") return fail(res, 409, "Duplicate key (email/phone) in this tenant");
    if (err?.code === "P2003") return fail(res, 400, "Invalid foreign key value");
    return fail(res, 500, "Server error creating user", err?.message);
  }
});

/**
 * PUT /api/users/:id
 * Tenant-scoped update
 * ✅ tenantId cannot be changed from body
 */
router.put("/:id", async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const userId = parseId(req.params.id);
    if (!userId) return fail(res, 400, "Invalid user ID");

    const existing = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });

    if (!existing) return fail(res, 404, "User not found");

    const name = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
    const email =
      req.body.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined;
    const phone =
      req.body.phone !== undefined ? (String(req.body.phone).trim() || null) : undefined;
    const role =
      req.body.role !== undefined ? String(req.body.role).trim().toUpperCase() : undefined;
    const password = req.body.password;

    // check uniqueness (if email/phone changes)
    if (email || phone) {
      const conflict = await prisma.user.findFirst({
        where: {
          tenantId,
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined,
          ].filter(Boolean),
          NOT: { id: userId },
        },
        select: { id: true },
      });

      if (conflict) {
        return fail(res, 409, "Email or phone already exists for another user in this tenant");
      }
    }

    // Never allow changing tenant from body (ignore any legacy keys)
    // eslint-disable-next-line no-unused-vars
    const { TenantId: _A, tenantId: _B, schoolId: _C, ...rest } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...rest,
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(password ? { password: await hashPassword(password) } : {}),
        tenantId, // enforce tenant
      },
      select: userSelectSafe,
    });

    return ok(res, { message: "User updated", data: updated });
  } catch (err) {
    console.error("❌ user update error:", err);
    if (err?.code === "P2002") return fail(res, 409, "Duplicate key (email/phone) in this tenant");
    if (err?.code === "P2025") return fail(res, 404, "User not found");
    return fail(res, 500, "Server error updating user", err?.message);
  }
});

/**
 * DELETE /api/users/:id
 * Tenant-scoped
 * - Safely detaches Parent.userId / Client.userId if linked
 */
router.delete("/:id", async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const userId = parseId(req.params.id);
    if (!userId) return fail(res, 400, "Invalid user ID");

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });

    if (!user) return fail(res, 404, "User not found");

    await prisma.$transaction(async (tx) => {
      await tx.parent.updateMany({ where: { userId }, data: { userId: null } });
      await tx.client.updateMany({ where: { userId }, data: { userId: null } });
      await tx.user.delete({ where: { id: userId } });
    });

    return ok(res, { message: "User deleted" });
  } catch (err) {
    console.error("❌ user delete error:", err);
    if (err?.code === "P2025") return fail(res, 404, "User not found");
    return fail(res, 500, "Server error deleting user", err?.message);
  }
});

export default router;