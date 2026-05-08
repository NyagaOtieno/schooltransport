import prisma from "../middleware/prisma.js";

export const getAssistants = async (req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "ASSISTANT" }, include: { busesAssisting: true } }));
};

export const getAssistant = async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createAssistant = async (req, res) => {
  res.json(await prisma.user.create({ data: { ...req.body, role: "ASSISTANT" } }));
};

export const updateAssistant = async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteAssistant = async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
};
