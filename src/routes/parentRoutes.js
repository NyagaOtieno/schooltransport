import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// -----------------------------
// GET all parents
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const parents = await prisma.parent.findMany({
      include: { 
        user: true, 
        students: { include: { bus: true, school: true } } 
      },
    });
    res.json(parents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

// -----------------------------
// GET a parent by ID
// -----------------------------
router.get("/:id", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (isNaN(parentId)) {
      return res.status(400).json({ status: "error", message: "Invalid parent ID" });
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: { 
        user: true, 
        students: { include: { bus: true, school: true } } 
      },
    });

    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });

    res.json(parent);
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

    if (!name || !email || !phone || !password || !schoolId) {
      return res.status(400).json({ status: "error", message: "name, email, phone, password, and schoolId are required" });
    }

    // Validate school
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });

    // Check if email or phone already exists in the same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [{ email }, { phone }],
      },
    });

    if (existingUser) {
      return res.status(400).json({ status: "error", message: "Email or phone already exists for this school" });
    }

    // Create user first
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: await bcrypt.hash(password, 10),
        role: "PARENT",
        schoolId,
      },
    });

    // Create parent record
    const parent = await prisma.parent.create({
      data: { userId: user.id },
      include: { user: true },
    });

    res.json(parent);
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
    const parentId = Number(req.params.id);
    if (isNaN(parentId)) {
      return res.status(400).json({ status: "error", message: "Invalid parent ID" });
    }

    // Check if parent exists
    const existingParent = await prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } });
    if (!existingParent) {
      return res.status(404).json({ status: "error", message: "Parent not found" });
    }

    const { name, email, phone, password, schoolId } = req.body;

    // Validate school if provided
    if (schoolId) {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) return res.status(400).json({ status: "error", message: "Invalid schoolId" });
    }

    // Check email/phone uniqueness within the same school
    if (email || phone) {
      const conflictUser = await prisma.user.findFirst({
        where: {
          schoolId: schoolId || existingParent.user.schoolId,
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined,
          ].filter(Boolean),
          NOT: { id: existingParent.user.id },
        },
      });
      if (conflictUser) {
        return res.status(400).json({ status: "error", message: "Email or phone already exists in this school" });
      }
    }

    // Update user record
    const updatedUser = await prisma.user.update({
      where: { id: existingParent.user.id },
      data: {
        name,
        email,
        phone,
        password: password ? await bcrypt.hash(password, 10) : undefined,
        schoolId,
      },
    });

    res.json({ ...existingParent, user: updatedUser });
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
    const parentId = Number(req.params.id);
    if (isNaN(parentId)) return res.status(400).json({ status: "error", message: "Invalid parent ID" });

    const parent = await prisma.parent.findUnique({ where: { id: parentId }, include: { user: true } });
    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });

    // Delete the parent user first (cascades if foreign keys set)
    await prisma.user.delete({ where: { id: parent.user.id } });

    // Delete parent record
    await prisma.parent.delete({ where: { id: parentId } });

    res.json({ status: "success", message: "Parent deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Server error", detail: error.message });
  }
});

export default router;
