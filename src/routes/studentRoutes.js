import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await prisma.student.findMany({ include: { school: true, bus: true, parent: true } }));
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.student.findUnique({ where: { id: Number(req.params.id) } }));
});

router.post("/", async (req, res) => {
  res.json(await prisma.student.create({ data: req.body }));
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.student.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.student.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
