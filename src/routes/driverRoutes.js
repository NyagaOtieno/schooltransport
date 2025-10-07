import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// Drivers are Users with role = DRIVER
router.get("/", async (req, res) => {
  try {
    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER" },
      include: { busesDriven: true },
    });
    res.json(drivers);
  } catch (err) {
    console.error("Error fetching drivers:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const driver = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!driver) return res.status(404).json({ status: "error", message: "Driver not found" });
    res.json(driver);
  } catch (err) {
    console.error(`Error fetching driver ${req.params.id}:`, err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// CREATE driver
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

    const driver = await prisma.user.create({
      data: { name, email, phone, busId, schoolId, role: "DRIVER" },
    });

    res.status(201).json(driver);
  } catch (err) {
    console.error("Error creating driver:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const driver = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json(driver);
  } catch (err) {
    console.error(`Error updating driver ${req.params.id}:`, err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const driver = await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.json(driver);
  } catch (err) {
    console.error(`Error deleting driver ${req.params.id}:`, err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

export default router;
