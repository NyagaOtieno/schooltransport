import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await prisma.bus.findMany({ include: { school: true, driver: true, assistant: true } }));
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.bus.findUnique({ where: { id: Number(req.params.id) } }));
});

router.post("/", async (req, res) => {
  res.json(await prisma.bus.create({ data: req.body }));
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.bus.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.bus.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
