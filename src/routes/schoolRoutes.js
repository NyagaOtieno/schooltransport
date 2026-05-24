import prisma from "../middleware/prisma.js";

/* =========================
   GET ALL SCHOOLS (tenant-safe)
========================= */
export const getSchools = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    const schools = await prisma.school.findMany({
      where: { tenantId },
      orderBy: { id: "desc" },
    });

    res.json({ success: true, data: schools });
  } catch (err) {
    console.error("[getSchools]", err);
    res.status(500).json({ success: false, message: "Failed to fetch schools" });
  }
};

/* =========================
   GET SINGLE SCHOOL
========================= */
export const getSchool = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const id = Number(req.params.id);

    const school = await prisma.school.findFirst({
      where: { id, tenantId },
    });

    if (!school) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    res.json({ success: true, data: school });
  } catch (err) {
    console.error("[getSchool]", err);
    res.status(500).json({ success: false, message: "Failed to fetch school" });
  }
};

/* =========================
   ONBOARD SCHOOL (AGENT + ADMIN)
========================= */
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

        tenantId: user.tenantId,
        createdById: user.id,
        agentId: user.role === "AGENT" ? user.id : null,
      },
    });

    res.status(201).json({
      success: true,
      data: school,
    });
  } catch (err) {
    console.error("[onboardSchool]", err);
    res.status(500).json({
      success: false,
      message: "Failed to onboard school",
    });
  }
};

/* =========================
   UPDATE SCHOOL (SAFE)
   - allows editing location, phone, etc.
========================= */
export const updateSchool = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const id = Number(req.params.id);

    const school = await prisma.school.findFirst({
      where: { id, tenantId },
    });

    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const updated = await prisma.school.update({
      where: { id },
      data: req.body, // allows editing location, county, phone, etc.
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[updateSchool]", err);
    res.status(500).json({ message: "Failed to update school" });
  }
};

/* =========================
   DELETE SCHOOL
========================= */
export const deleteSchool = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const id = Number(req.params.id);

    const school = await prisma.school.findFirst({
      where: { id, tenantId },
    });

    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    await prisma.school.delete({ where: { id } });

    res.json({ success: true, message: "School deleted" });
  } catch (err) {
    console.error("[deleteSchool]", err);
    res.status(500).json({ message: "Failed to delete school" });
  }
};