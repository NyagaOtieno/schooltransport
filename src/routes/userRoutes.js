import express from "express";
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// -----------------------------
// Get all users
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany({ include: { school: true } });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// Get user by ID
// -----------------------------
router.get("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { school: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// Create user
// -----------------------------
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, schoolId, role, password } = req.body;

    if (!schoolId || (!email && !phone)) {
      return res.status(400).json({ error: "Email or phone and schoolId are required" });
    }

    // Check for existing user in same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined
        ].filter(Boolean),
      },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Email or phone already exists for this school. You can only update the existing user."
      });
    }

    // Hash password if provided
    const hashedPassword = password ? await bcrypt.hash(password, 10) : await bcrypt.hash("changeme", 10);

    const newUser = await prisma.user.create({
      data: { name, email, phone, schoolId, role: role || "USER", password: hashedPassword },
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// Update user
// -----------------------------
router.put("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

    const { email, phone, schoolId, password, name, role } = req.body;

    // Check for conflicts in same school
    if ((email || phone) && schoolId) {
      const conflictUser = await prisma.user.findFirst({
        where: {
          schoolId,
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined
          ].filter(Boolean),
          NOT: { id: userId },
        },
      });
      if (conflictUser) {
        return res.status(409).json({ error: "Email or phone already exists for another user in this school." });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        email,
        phone,
        schoolId,
        role,
        password: password ? await bcrypt.hash(password, 10) : undefined
      },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// Delete user
// -----------------------------
router.delete("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

    // Remove parent linkage if exists
    const parent = await prisma.parent.findFirst({ where: { userId } });
    if (parent) {
      await prisma.parent.update({ where: { id: parent.id }, data: { userId: null } });
    }

    const deletedUser = await prisma.user.delete({ where: { id: userId } });
    res.json(deletedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
