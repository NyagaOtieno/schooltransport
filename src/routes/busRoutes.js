import express from "express";
import prisma from "../middleware/prisma.js";

const router = express.Router();

// GET all buses
router.get("/", async (req, res) => {
  try {
    const buses = await prisma.bus.findMany({
      include: { school: true, driver: true, assistant: true },
    });
    res.json(buses);
  } catch (err) {
    console.error("Error fetching buses:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// GET bus by ID
router.get("/:id", async (req, res) => {
  try {
    const bus = await prisma.bus.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!bus) return res.status(404).json({ status: "error", message: "Bus not found" });
    res.json(bus);
  } catch (err) {
    console.error(`Error fetching bus ${req.params.id}:`, err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// CREATE bus
router.post("/", async (req, res) => {
  try {
    const bus = await prisma.bus.create({ data: req.body });
    res.json(bus);
  } catch (err) {
    console.error("Error creating bus:", err);
    // Prisma foreign key or unique constraint errors
    if (err.code === "P2002") {
      return res.status(400).json({ status: "error", message: "Bus plate already exists" });
    }
    if (err.code === "P2003") {
      return res.status(400).json({ status: "error", message: "Invalid driver, assistant, or school ID" });
    }
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// UPDATE bus
router.put("/:id", async (req, res) => {
  try {
    const bus = await prisma.bus.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json(bus);
  } catch (err) {
    console.error(`Error updating bus ${req.params.id}:`, err);
    if (err.code === "P2002") {
      return res.status(400).json({ status: "error", message: "Bus plate already exists" });
    }
    if (err.code === "P2003") {
      return res.status(400).json({ status: "error", message: "Invalid driver, assistant, or school ID" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ status: "error", message: "Bus not found" });
    }
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// DELETE bus
router.delete("/:id", async (req, res) => {
  try {
    const bus = await prisma.bus.delete({ where: { id: Number(req.params.id) } });
    res.json(bus);
  } catch (err) {
    console.error(`Error deleting bus ${req.params.id}:`, err);
    if (err.code === "P2025") {
      return res.status(404).json({ status: "error", message: "Bus not found" });
    }
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

export default router;
