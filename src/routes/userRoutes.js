import express from "express";
import prisma from "../middleware/prisma.js";

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
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
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
    const { email, phone, schoolId } = req.body;

    if (!email || !phone || !schoolId) {
      return res.status(400).json({ error: "Email, phone, and schoolId are required" });
    }

    // Check if email or phone exists in same school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [{ email }, { phone }]
      }
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Email or phone already exists for this school. You can only update the existing user."
      });
    }

    const newUser = await prisma.user.create({ data: req.body });
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
    const { email, phone, schoolId } = req.body;

    // Check if email or phone conflicts with other users in the same school
    if ((email || phone) && schoolId) {
      const conflictingUser = await prisma.user.findFirst({
        where: {
          schoolId,
          OR: [{ email }, { phone }],
          NOT: { id: userId }
        }
      });

      if (conflictingUser) {
        return res.status(409).json({
          error: "Email or phone already exists for another user in this school."
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: req.body
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
    const deletedUser = await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.json(deletedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
