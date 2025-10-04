import prisma from "../middleware/prisma.js";

export const getStudents = async (req, res) => {
  res.json(await prisma.student.findMany({ include: { school: true, bus: true, parent: true } }));
};

export const getStudent = async (req, res) => {
  res.json(await prisma.student.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createStudent = async (req, res) => {
  res.json(await prisma.student.create({ data: req.body }));
};

export const updateStudent = async (req, res) => {
  res.json(await prisma.student.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteStudent = async (req, res) => {
  res.json(await prisma.student.delete({ where: { id: Number(req.params.id) } }));
};
