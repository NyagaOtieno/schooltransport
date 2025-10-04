import prisma from "../middleware/prisma.js";

export const getUsers = async (req, res) => {
  res.json(await prisma.user.findMany({ include: { school: true } }));
};

export const getUser = async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createUser = async (req, res) => {
  res.json(await prisma.user.create({ data: req.body }));
};

export const updateUser = async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteUser = async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
};
