import prisma from "../middleware/prisma.js";

export const getAssets = async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      include: { parent: { include: { user: true } }, bus: true, school: true },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: assets });
  } catch (error) {
    console.error("Error fetching assets:", error);
    res.status(500).json({ success: false, message: "Server error fetching assets" });
  }
};

export const getAsset = async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: Number(req.params.id) },
      include: { parent: { include: { user: true } }, bus: true, school: true },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });
    res.status(200).json({ success: true, data: asset });
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.status(500).json({ success: false, message: "Server error fetching asset" });
  }
};

export const createAsset = async (req, res) => {
  try {
    const { name, type, tag, parentId, busId, schoolId } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Asset name is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    if (busId) {
      const bus = await prisma.bus.findUnique({ where: { id: Number(busId) } });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    }

    if (parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: Number(parentId) } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    const asset = await prisma.asset.create({
      data: {
        name: name.toString().trim(),
        type: type ?? null,
        tag: tag ?? null,
        parentId: parentId ? Number(parentId) : null,
        busId: busId ? Number(busId) : null,
        schoolId: Number(schoolId),
      },
      include: { parent: { include: { user: true } }, bus: true, school: true },
    });

    res.status(201).json({ success: true, message: "Asset created successfully", data: asset });
  } catch (error) {
    console.error("Error creating asset:", error);
    res.status(500).json({ success: false, message: "Server error creating asset" });
  }
};

export const updateAsset = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.body.busId) {
      const bus = await prisma.bus.findUnique({ where: { id: Number(req.body.busId) } });
      if (!bus) return res.status(404).json({ success: false, message: "Bus not found" });
    }
    if (req.body.parentId) {
      const parent = await prisma.parent.findUnique({ where: { id: Number(req.body.parentId) } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent/Client not found" });
    }

    const updated = await prisma.asset.update({
      where: { id: Number(id) },
      data: {
        ...req.body,
        ...(req.body.parentId !== undefined ? { parentId: req.body.parentId ? Number(req.body.parentId) : null } : {}),
        ...(req.body.busId !== undefined ? { busId: req.body.busId ? Number(req.body.busId) : null } : {}),
        ...(req.body.schoolId !== undefined ? { schoolId: Number(req.body.schoolId) } : {}),
      },
      include: { parent: { include: { user: true } }, bus: true, school: true },
    });

    res.status(200).json({ success: true, message: "Asset updated successfully", data: updated });
  } catch (error) {
    console.error("Error updating asset:", error);
    res.status(500).json({ success: false, message: "Server error updating asset" });
  }
};

export const deleteAsset = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.asset.delete({ where: { id: Number(id) } });
    res.status(200).json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    console.error("Error deleting asset:", error);
    res.status(500).json({ success: false, message: "Server error deleting asset" });
  }
};
