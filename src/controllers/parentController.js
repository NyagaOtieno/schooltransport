import prisma from "../middleware/prisma.js";

export const getParents = async (req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "PARENT" }, include: { students: true } }));
};

export const getParent = async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createParent = async (req, res) => {
  res.json(await prisma.user.create({ data: { ...req.body, role: "PARENT" } }));
};

export const updateParent = async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteParent = async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
};
