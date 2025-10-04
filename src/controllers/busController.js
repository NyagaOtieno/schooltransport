import prisma from "../middleware/prisma.js";

export const getBuses = async (req, res) => {
  res.json(await prisma.bus.findMany({ include: { school: true, driver: true, assistant: true } }));
};

export const getBus = async (req, res) => {
  res.json(await prisma.bus.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createBus = async (req, res) => {
  res.json(await prisma.bus.create({ data: req.body }));
};

export const updateBus = async (req, res) => {
  res.json(await prisma.bus.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteBus = async (req, res) => {
  res.json(await prisma.bus.delete({ where: { id: Number(req.params.id) } }));
};
