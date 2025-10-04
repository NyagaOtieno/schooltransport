import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await prisma.manifest.findMany({ include: { student: true, bus: true, assistant: true } }));
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.manifest.findUnique({ where: { id: Number(req.params.id) } }));
});

router.post("/", async (req, res) => {
  res.json(await prisma.manifest.create({ data: req.body }));
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.manifest.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.manifest.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
