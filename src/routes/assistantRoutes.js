import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Assistants are Users with role = ASSISTANT
router.get("/", async (req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "ASSISTANT" }, include: { busesAssisting: true } }));
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
});

router.post("/", async (req, res) => {
  const data = { ...req.body, role: "ASSISTANT" };
  res.json(await prisma.user.create({ data }));
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
