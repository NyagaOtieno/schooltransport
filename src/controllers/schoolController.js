import prisma from "../middleware/prisma.js";

export const getSchools = async (req, res) => {
  res.json(await prisma.school.findMany());
};

export const getSchool = async (req, res) => {
  res.json(await prisma.school.findUnique({ where: { id: Number(req.params.id) } }));
};

export const onboardSchool = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!["AGENT", "SYSTEM_ADMIN"].includes(user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const {
      schoolName,
      schoolCode,
      county,
      email,
      phone,
      buses,
      tier,
    } = req.body;

    const school = await prisma.school.create({
      data: {
        name: schoolName,
        code: schoolCode,
        county,
        email,
        phone,
        buses,
        tier,

        // 🔥 IMPORTANT: multi-tenant safety
        tenantId: user.tenantId,

        // 🔥 track ownership
        createdById: user.id,
        agentId: user.role === "AGENT" ? user.id : null,
      },
    });

    return res.status(201).json({
      success: true,
      schoolId: school.id,
      school,
    });

  } catch (err) {
    console.error("[onboardSchool]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to onboard school",
    });
  }
};

export const updateSchool = async (req, res) => {
  res.json(await prisma.school.update({ where: { id: Number(req.params.id) }, data: req.body }));
};

export const deleteSchool = async (req, res) => {
  res.json(await prisma.school.delete({ where: { id: Number(req.params.id) } }));
};
