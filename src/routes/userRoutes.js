import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Get all users
router.get("/", async (req, res) => {
  res.json(await prisma.user.findMany({ include: { school: true } }));
});

// Get user by ID
router.get("/:id", async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
});

// Create user
router.post("/", async (req, res) => {
  res.json(await prisma.user.create({ data: req.body }));
});

// Update user
router.put("/:id", async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

// Delete user
router.delete("/:id", async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
