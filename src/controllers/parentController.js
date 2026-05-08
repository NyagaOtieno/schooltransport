import prisma from "../middleware/prisma.js";

const handleError = (res, error, message = "Server error") => {
  console.error(error);
  res.status(500).json({ status: "error", message, detail: error.message });
};

// 🧩 Get all parents
export const getParents = async (req, res) => {
  try {
    const parents = await prisma.parent.findMany({
      include: { students: true, notifications: true },
      orderBy: { id: "desc" },
    });
    res.json({ status: "success", count: parents.length, data: parents });
  } catch (error) {
    handleError(res, error, "Failed to fetch parents");
  }
};

// 🧩 Get single parent
export const getParent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid parent ID" });

    const parent = await prisma.parent.findUnique({
      where: { id },
      include: { students: true, notifications: true },
    });

    if (!parent) return res.status(404).json({ status: "error", message: "Parent not found" });
    res.json({ status: "success", data: parent });
  } catch (error) {
    handleError(res, error, "Failed to fetch parent");
  }
};

// 🧩 Create or reuse parent
export const createParent = async (req, res) => {
  try {
    const { name, phone, schoolId } = req.body;

    if (!phone) return res.status(400).json({ status: "error", message: "Phone number is required" });

    // Check if parent exists
    let parent = await prisma.parent.findUnique({ where: { phone } });

    // Create if doesn't exist
    if (!parent) {
      parent = await prisma.parent.create({ data: { name: name || "Parent", phone } });
    }

    // Check if user exists for this parent
    let user = await prisma.user.findFirst({
      where: { phone, role: "PARENT" },
    });

    // If user doesn't exist, create one
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: name || parent.name,
          phone,
          password: "changeme",
          schoolId,
          role: "PARENT",
        },
      });

      await prisma.parent.update({
        where: { id: parent.id },
        data: { userId: user.id },
      });
    }

    res.json({
      status: "success",
      message: "Parent created or reused successfully",
      parent,
      user,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// 🧩 Update parent
export const updateParent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid parent ID" });

    const updated = await prisma.parent.update({
      where: { id },
      data: req.body,
      include: { students: true },
    });

    res.json({ status: "success", message: "Parent updated", data: updated });
  } catch (error) {
    handleError(res, error, "Failed to update parent");
  }
};

// 🧩 Delete parent
export const deleteParent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "error", message: "Invalid parent ID" });

    await prisma.parent.delete({ where: { id } });
    res.json({ status: "success", message: "Parent deleted successfully" });
  } catch (error) {
    handleError(res, error, "Failed to delete parent");
  }
};
