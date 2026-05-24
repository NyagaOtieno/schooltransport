import prisma from "../middleware/prisma.js";

export const getSchools = async (req, res) => {
  res.json(await prisma.school.findMany());
};

export const getSchool = async (req, res) => {
  res.json(await prisma.school.findUnique({ where: { id: Number(req.params.id) } }));
};

export const createSchool = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        message: "Unauthorized"
      });
    }

    // Allow only SYSTEM_ADMIN or AGENT
    if (!["SYSTEM_ADMIN", "AGENT"].includes(user.role)) {
      return res.status(403).json({
        message: "You are not allowed to create schools"
      });
    }

    const school = await prisma.school.create({
      data: {
        ...req.body,

        // IMPORTANT: enforce tenant isolation
        tenantId: user.tenantId,

        // OPTIONAL: track who created it
        createdById: user.id,
      },
    });

    return res.status(201).json(school);

  } catch (err) {
    console.error("[createSchool]", err);
    return res.status(500).json({
      message: "Failed to create school"
    });
  }
};

export const updateSchool = async (req, res) => {
  res.json(await prisma.school.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteSchool = async (req, res) => {
  res.json(await prisma.school.delete({ where: { id: Number(req.params.id) } }));
};
