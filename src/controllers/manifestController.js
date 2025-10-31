import prisma from "../middleware/prisma.js";
import { notifyParent } from "../services/notification.service.js";

/**
 * ✅ Get all manifests
 */
export const getManifests = async (req, res) => {
  try {
    const manifests = await prisma.manifest.findMany({
      include: { student: true, bus: true, assistant: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      count: manifests.length,
      data: manifests,
    });
  } catch (error) {
    console.error("❌ Error fetching manifests:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching manifests" });
  }
};

/**
 * ✅ Get single manifest
 */
export const getManifest = async (req, res) => {
  try {
    const manifest = await prisma.manifest.findUnique({
      where: { id: Number(req.params.id) },
      include: { student: true, bus: true, assistant: true },
    });

    if (!manifest) {
      return res
        .status(404)
        .json({ success: false, message: "Manifest not found" });
    }

    res.status(200).json({ success: true, data: manifest });
  } catch (error) {
    console.error("❌ Error fetching manifest:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching manifest" });
  }
};

/**
 * ✅ Create manifest (auto morning/evening session)
 */
export const createManifest = async (req, res) => {
  try {
    const {
      studentId,
      busId,
      assistantId,
      latitude,
      longitude,
      status,
      session,
    } = req.body;

    const now = new Date();
    const hours = now.getHours();
    const finalSession = session || (hours < 12 ? "MORNING" : "EVENING");

    const manifest = await prisma.manifest.create({
      data: {
        studentId,
        busId,
        assistantId,
        latitude,
        longitude,
        status,
        session: finalSession,
      },
      include: { student: true, bus: true, assistant: true },
    });

    // 🔔 Optional: Notify parent if status is onboarding/offboarding
    if (["onBoard", "offBoard"].includes(status)) {
      try {
        await notifyParent(status, manifest.student, manifest.bus?.plateNumber);
      } catch (notifyError) {
        console.warn("⚠️ Failed to send SMS notification:", notifyError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: "Manifest created successfully",
      data: manifest,
    });
  } catch (error) {
    console.error("❌ Error creating manifest:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error creating manifest" });
  }
};

/**
 * ✅ Update manifest (with SMS trigger)
 */
export const updateManifest = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updated = await prisma.manifest.update({
      where: { id: Number(id) },
      data,
      include: { student: true, bus: true },
    });

    // 🔔 Notify parent when status changes to onboard/offboard
    if (["onBoard", "offBoard"].includes(data.status)) {
      try {
        await notifyParent(data.status, updated.student, updated.bus?.plateNumber);
      } catch (notifyError) {
        console.warn("⚠️ Failed to send SMS notification:", notifyError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: "Manifest updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("❌ Error updating manifest:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error updating manifest" });
  }
};

/**
 * ✅ Delete manifest
 */
export const deleteManifest = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.manifest.delete({ where: { id: Number(id) } });

    res
      .status(200)
      .json({ success: true, message: "Manifest deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting manifest:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error deleting manifest" });
  }
};
