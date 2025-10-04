import prisma from "../middleware/prisma.js";

export const getSchools = async (req, res) => {
  res.json(await prisma.school.findMany());
};

export const getSchool = async (req, res) => {
  res.json(await prisma.school.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createSchool = async (req, res) => {
  res.json(await prisma.school.create({ data: req.body }));
};

export const updateSchool = async (req, res) => {
  res.json(await prisma.school.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteSchool = async (req, res) => {
  res.json(await prisma.school.delete({ where: { id: Number(req.params.id) } }));
};
