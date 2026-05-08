// src/controllers/manifestController.js
import prisma from "../middleware/prisma.js";
import { notifyRecipient } from "../services/notification.service.js";

/** Map incoming status to Prisma enum */
function mapStatusToEnum(status) {
  if (!status) return null;
  const s = status.toString().toLowerCase();

  if (["onboard", "checked_in", "checkin", "in", "boarded"].includes(s)) return "CHECKED_IN";
  if (["offboard", "checked_out", "checkout", "out", "alighted"].includes(s)) return "CHECKED_OUT";
  if (["CHECKED_IN", "CHECKED_OUT"].includes(status)) return status;

  return null;
}

/**
 * ✅ Get all manifests (scoped to merchant/school)
 */
export const getManifests = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const manifests = await prisma.manifest.findMany({
      where: { bus: { schoolId } },
      include: {
        bus: true,
        assistant: true,
        student: { include: { parent: { include: { user: true } }, school: true } },
        asset: { include: { parent: { include: { user: true } }, school: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, count: manifests.length, data: manifests });
  } catch (error) {
    console.error("❌ Error fetching manifests:", error);
    res.status(500).json({ success: false, message: "Server error fetching manifests" });
  }
};

/**
 * ✅ Get single manifest (scoped)
 */
export const getManifest = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const manifest = await prisma.manifest.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        bus: true,
        assistant: true,
        student: { include: { parent: { include: { user: true } }, school: true } },
        asset: { include: { parent: { include: { user: true } }, school: true } },
      },
    });

    if (!manifest || manifest.bus.schoolId !== schoolId) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    res.status(200).json({ success: true, data: manifest });
  } catch (error) {
    console.error("❌ Error fetching manifest:", error);
    res.status(500).json({ success: false, message: "Server error fetching manifest" });
  }
};

/**
 * ✅ CREATE manifest (Student OR Asset)
 * Body supports: studentId OR assetId, busId, assistantId(optional), status, lat/lng(optional), session(optional)
 */
export const createManifest = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { studentId, assetId, busId, assistantId, latitude, longitude, status, session } = req.body;

    // Must provide exactly one subject
    if (!!studentId === !!assetId) {
      return res.status(400).json({
        success: false,
        message: "Provide exactly one: studentId OR assetId",
      });
    }

    // Ensure bus belongs to this school
    const bus = await prisma.bus.findFirst({
      where: { id: Number(busId), schoolId },
    });
    if (!bus) return res.status(400).json({ success: false, message: "Invalid bus for this school" });

    // Get merchant mode (KID/ASSET) for messaging
    const school = await prisma.school.findUnique({ where: { id: schoolId } });

    // Session default
    const now = new Date();
    const hours = now.getHours();
    const finalSession = session || (hours < 12 ? "MORNING" : "EVENING");

    // Status enum
    const statusEnum = mapStatusToEnum(status);
    if (!statusEnum) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use onBoard/offBoard or CHECKED_IN/CHECKED_OUT.",
      });
    }

    const manifestData = {
      studentId: studentId ? Number(studentId) : null,
      assetId: assetId ? Number(assetId) : null,
      busId: Number(busId),
      assistantId: assistantId ? Number(assistantId) : (req.user?.id ?? null),
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: statusEnum,
      session: finalSession,
      boardingTime: statusEnum === "CHECKED_IN" ? now : null,
      alightingTime: statusEnum === "CHECKED_OUT" ? now : null,
    };

    const manifest = await prisma.manifest.create({
      data: manifestData,
      include: {
        bus: true,
        assistant: true,
        student: { include: { parent: { include: { user: true } }, school: true } },
        asset: { include: { parent: { include: { user: true } }, school: true } },
      },
    });

    // 🔔 Notify recipient
    const subject = manifest.student || manifest.asset;
    const recipientUser = subject?.parent?.user;
    const mode = school?.mode || subject?.school?.mode || "KID";

    if (recipientUser?.phone) {
      await notifyRecipient({
        recipientName: recipientUser.name || "Client",
        recipientPhone: recipientUser.phone,
        subjectName: subject?.name || "Item",
        eventType: statusEnum, // ✅ IMPORTANT: notifyRecipient expects eventType, not "action"
        busNumber: manifest.bus?.plateNumber,
        session: finalSession,
        mode,
      });
    }

    res.status(201).json({ success: true, message: "Manifest created successfully", data: manifest });
  } catch (error) {
    console.error("❌ Error creating manifest:", error);
    res.status(500).json({ success: false, message: "Server error creating manifest" });
  }
};

/**
 * ✅ UPDATE manifest (scoped)
 */
export const updateManifest = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;
    const { status, latitude, longitude, ...otherData } = req.body;

    const existing = await prisma.manifest.findUnique({
      where: { id: Number(id) },
      include: { bus: true },
    });

    if (!existing || existing.bus.schoolId !== schoolId) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId } });

    const now = new Date();
    const statusEnum = status ? mapStatusToEnum(status) : null;
    if (status && !statusEnum) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const updateData = {
      ...otherData,
      latitude: latitude ?? existing.latitude,
      longitude: longitude ?? existing.longitude,
      ...(statusEnum ? { status: statusEnum } : {}),
      ...(statusEnum === "CHECKED_IN" ? { boardingTime: now } : {}),
      ...(statusEnum === "CHECKED_OUT" ? { alightingTime: now } : {}),
    };

    const updated = await prisma.manifest.update({
      where: { id: Number(id) },
      data: updateData,
      include: {
        bus: true,
        student: { include: { parent: { include: { user: true } }, school: true } },
        asset: { include: { parent: { include: { user: true } }, school: true } },
      },
    });

    // 🔔 Notify recipient when status changed
    if (statusEnum) {
      const subject = updated.student || updated.asset;
      const recipientUser = subject?.parent?.user;
      const mode = school?.mode || subject?.school?.mode || "KID";

      if (recipientUser?.phone) {
        await notifyRecipient({
          recipientName: recipientUser.name || "Client",
          recipientPhone: recipientUser.phone,
          subjectName: subject?.name || "Item",
          eventType: statusEnum,
          busNumber: updated.bus?.plateNumber,
          session: updated.session,
          mode,
        });
      }
    }

    res.status(200).json({ success: true, message: "Manifest updated successfully", data: updated });
  } catch (error) {
    console.error("❌ Error updating manifest:", error);
    res.status(500).json({ success: false, message: "Server error updating manifest" });
  }
};

/**
 * ✅ Delete manifest (scoped)
 */
export const deleteManifest = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;

    const existing = await prisma.manifest.findUnique({
      where: { id: Number(id) },
      include: { bus: true },
    });

    if (!existing || existing.bus.schoolId !== schoolId) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    await prisma.manifest.delete({ where: { id: Number(id) } });

    res.status(200).json({ success: true, message: "Manifest deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting manifest:", error);
    res.status(500).json({ success: false, message: "Server error deleting manifest" });
  }
};
