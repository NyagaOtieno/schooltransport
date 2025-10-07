import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Assistants are Users with role = ASSISTANT
router.get("/", async (req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "ASSISTANT" }, include: { busesAssisting: true } }));
});

router.get("/:id", async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: Number(req.params.id) } }));
});

// CREATE assistant
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, busId, schoolId } = req.body;

    if (!name || !email || !phone || !busId || !schoolId) {
      return res.status(400).json({ status: "error", message: "Name, email, phone, busId, and schoolId are required" });
    }

    // Check school exists
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return res.status(400).json({ status: "error", message: "School does not exist" });

    // Check bus exists and is linked to school
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus || bus.schoolId !== schoolId) {
      return res.status(400).json({ status: "error", message: "Bus does not exist or is not linked to this school" });
    }

    const assistant = await prisma.user.create({
      data: { name, email, phone, busId, schoolId, role: "ASSISTANT" },
    });

    res.status(201).json(assistant);
  } catch (err) {
    console.error("Error creating assistant:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  res.json(await prisma.user.update({ where: { id: Number(req.params.id) }, data: req.body }));
});

router.delete("/:id", async (req, res) => {
  res.json(await prisma.user.delete({ where: { id: Number(req.params.id) } }));
});

export default router;
