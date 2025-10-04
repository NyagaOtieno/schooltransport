import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await prisma.school.findMany());
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.school.findUnique({ where: { id: Number(req.params.id) } }));
});

router.post("/", async (req, res) => {
  res.json(await prisma.school.create({ data: req.body }));
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.school.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.school.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
