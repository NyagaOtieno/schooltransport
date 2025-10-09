import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// Helper to validate IDs
const parseId = (id) => {
  const parsed = Number(id);
  if (isNaN(parsed)) throw new Error("Invalid ID");
  return parsed;
};

// -----------------------------
// GET all parents
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const parents = await prisma.parent.findMany({
      include: {
        user: true,
        students: { include: { bus: true, school: true } },
      },
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: parents.length, data: parents });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// GET parent by ID
// -----------------------------
router.get("/:id", async (req, res) => {
  try {
    const parentId = parseId(req.params.id);

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: { user: true, students: { include: { bus: true, school: true } } },
    });

    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });
    res.json({ status: "success", data: parent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// CREATE a new parent
// -----------------------------
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, password, schoolId } = req.body;

    if (!name || !phone || !schoolId) {
      return res.status(400).json({ status: "error", message: "name, phone, and schoolId are required" });
    }

    // Validate school
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });

    // Check for existing user within same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
    });

    if (existingUser) {
      return res.status(400).json({ status: "error", message: "Email or phone already exists in this school" });
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: password ? await bcrypt.hash(password, 10) : await bcrypt.hash("changeme", 10),
        role: "PARENT",
        schoolId,
      },
    });

    // Create parent record
    const parent = await prisma.parent.create({
      data: { userId: user.id },
      include: { user: true },
    });

    res.json({ status: "success", parent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// UPDATE a parent
// -----------------------------
router.put("/:id", async (req, res) => {
  try {
    const parentId = parseId(req.params.id);
    const { name, email, phone, password, schoolId } = req.body;

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: { user: true },
    });
    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });

    // Validate school if provided
    if (schoolId) {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    }

    // Check uniqueness for email/phone within the school
    if (email || phone) {
      const conflictUser = await prisma.user.findFirst({
        where: {
          schoolId: schoolId || parent.user.schoolId,
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined,
          ].filter(Boolean),
          NOT: { id: parent.user.id },
        },
      });
      if (conflictUser) return res.status(400).json({ status: "error", message: "Email or phone already exists in this school" });
    }

    // Update user record
    const updatedUser = await prisma.user.update({
      where: { id: parent.user.id },
      data: {
        name,
        email,
        phone,
        password: password ? await bcrypt.hash(password, 10) : undefined,
        schoolId,
      },
    });

    res.json({ status: "success", message: "Parent updated", parent: { ...parent, user: updatedUser } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// DELETE a parent
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const parentId = parseId(req.params.id);

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: { user: true },
    });
    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });

    // Delete user first to avoid foreign key errors
    await prisma.user.delete({ where: { id: parent.user.id } });
    await prisma.parent.delete({ where: { id: parentId } });

    res.json({ status: "success", message: "Parent deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

export default router;
