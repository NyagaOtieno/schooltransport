import prisma from "../middleware/prisma.js";

export const getManifests = async (req, res) => {
  res.json(await prisma.manifest.findMany({ include: { student: true, bus: true, assistant: true } }));
};

export const getManifest = async (req, res) => {
  res.json(await prisma.manifest.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createManifest = async (req, res) => {
  res.json(await prisma.manifest.create({ data: req.body }));
};

export const updateManifest = async (req, res) => {
  res.json(await prisma.manifest.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteManifest = async (req, res) => {
  res.json(await prisma.manifest.delete({ where: { id: Number(req.params.id) } }));
};
