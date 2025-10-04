import prisma from "../middleware/prisma.js";

export const getDrivers = async (req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "DRIVER" }, include: { busesDriven: true } }));
};

export const getDriver = async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createDriver = async (req, res) => {
  res.json(await prisma.user.create({ data: { ...req.body, role: "DRIVER" } }));
};

export const updateDriver = async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteDriver = async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
};
