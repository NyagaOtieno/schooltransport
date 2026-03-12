// src/routes/manifestRoutes.js
import express from "express";
import prisma from "../middleware/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { notifyRecipient, notifyParent } from "../services/notification.service.js";

const router = express.Router();

/* =========================
   Helpers
========================= */
function requireTenant(req, res) {
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    res.status(403).json({
      success: false,
      message: "Forbidden: token missing tenantId",
    });
    return null;
  }

  const parsedTenantId = Number(tenantId);

  if (!Number.isFinite(parsedTenantId)) {
    res.status(400).json({
      success: false,
      message: "Invalid tenantId in token",
    });
    return null;
  }

  return parsedTenantId;
}

function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toManifestStatus(status) {
  if (!status) return null;

  const raw = String(status).trim();
  const normalized = raw.toLowerCase();

  if (["checked_in", "onboard", "onboarded", "checkin", "in"].includes(normalized)) {
    return "CHECKED_IN";
  }

  if (["checked_out", "offboard", "offboarded", "checkout", "out"].includes(normalized)) {
    return "CHECKED_OUT";
  }

  if (["CHECKED_IN", "CHECKED_OUT"].includes(raw)) {
    return raw;
  }

  return null;
}

function resolveSession(session) {
  if (session) {
    const normalized = String(session).trim().toUpperCase();
    if (["MORNING", "EVENING"].includes(normalized)) {
      return normalized;
    }
  }

  const currentHour = new Date().getHours();
  return currentHour < 12 ? "MORNING" : "EVENING";
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function cleanOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* =========================================================
   GET all manifests
   ========================================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const manifests = await prisma.manifest.findMany({
      where: {
        bus: { tenantId },
      },
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      count: manifests.length,
      data: manifests,
    });
  } catch (error) {
    console.error("Error fetching manifests:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching manifests",
      detail: error?.message,
    });
  }
});

/* =========================================================
   GET manifest by ID
   ========================================================= */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const manifestId = parseId(req.params.id);
    if (!manifestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid manifest id",
      });
    }

    const manifest = await prisma.manifest.findFirst({
      where: {
        id: manifestId,
        bus: { tenantId },
      },
      include: {
        student: true,
        asset: true,
        bus: true,
        assistant: true,
      },
    });

    if (!manifest) {
      return res.status(404).json({
        success: false,
        message: "Manifest not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: manifest,
    });
  } catch (error) {
    console.error("Error fetching manifest:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching manifest",
      detail: error?.message,
    });
  }
});

/* =========================================================
   CREATE manifest
   ========================================================= */
router.post(
  "/",
  authMiddleware,
  requireRole("ADMIN", "SCHOOL", "ASSISTANT"),
  async (req, res) => {
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;

      const {
        studentId,
        assetId,
        busId,
        assistantId,
        status,
        latitude,
        longitude,
        session,
      } = req.body;

      if (!!studentId === !!assetId) {
        return res.status(400).json({
          success: false,
          message: "Provide exactly one: studentId OR assetId",
        });
      }

      const statusEnum = toManifestStatus(status);
      if (!statusEnum) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Use CHECKED_IN/CHECKED_OUT or onboard/offboard.",
        });
      }

      const busIdNum = parseId(busId);
      const assistantIdNum = parseId(assistantId);
      const studentIdNum = parseId(studentId);
      const assetIdNum = parseId(assetId);

      if (!busIdNum) {
        return res.status(400).json({
          success: false,
          message: "busId is required",
        });
      }

      if (!assistantIdNum) {
        return res.status(400).json({
          success: false,
          message: "assistantId is required",
        });
      }

      if (studentId !== undefined && studentId !== null && !studentIdNum) {
        return res.status(400).json({
          success: false,
          message: "Invalid studentId",
        });
      }

      if (assetId !== undefined && assetId !== null && !assetIdNum) {
        return res.status(400).json({
          success: false,
          message: "Invalid assetId",
        });
      }

      const bus = await prisma.bus.findFirst({
        where: {
          id: busIdNum,
          tenantId,
        },
        select: {
          id: true,
          plateNumber: true,
          assistantId: true,
        },
      });

      if (!bus) {
        return res.status(404).json({
          success: false,
          message: "Bus not found for this tenant",
        });
      }

      const assistant = await prisma.user.findFirst({
        where: {
          id: assistantIdNum,
          tenantId,
          role: "ASSISTANT",
        },
        select: {
          id: true,
          name: true,
          phone: true,
        },
      });

      if (!assistant) {
        return res.status(400).json({
          success: false,
          message: "Assistant not found for this tenant",
        });
      }

      if (bus.assistantId !== assistant.id) {
        return res.status(400).json({
          success: false,
          message: "Assistant not assigned to this bus",
        });
      }

      const sessionValue = resolveSession(session);
      const { start, end } = todayRange();

      const duplicateWhere = {
        busId: busIdNum,
        status: statusEnum,
        session: sessionValue,
        createdAt: {
          gte: start,
          lte: end,
        },
        ...(studentIdNum ? { studentId: studentIdNum } : {}),
        ...(assetIdNum ? { assetId: assetIdNum } : {}),
      };

      const existingManifest = await prisma.manifest.findFirst({
        where: duplicateWhere,
        select: { id: true },
      });

      if (existingManifest) {
        const subjectLabel = studentIdNum ? "Student" : "Asset";
        return res.status(409).json({
          success: false,
          message: `${subjectLabel} has already ${
            statusEnum === "CHECKED_IN" ? "checked in" : "checked out"
          } for this bus in the ${sessionValue.toLowerCase()} session today.`,
        });
      }

      let subject = null;
      let mode = "KID";

      if (studentIdNum) {
        subject = await prisma.student.findFirst({
          where: {
            id: studentIdNum,
            tenantId,
          },
          include: {
            parent: {
              include: {
                user: true,
              },
            },
            tenant: {
              select: {
                mode: true,
              },
            },
          },
        });

        if (!subject) {
          return res.status(404).json({
            success: false,
            message: "Student not found",
          });
        }

        mode = subject.tenant?.mode || "KID";
      } else {
        subject = await prisma.asset.findFirst({
          where: {
            id: assetIdNum,
            tenantId,
          },
          include: {
            client: {
              include: {
                user: true,
              },
            },
            tenant: {
              select: {
                mode: true,
              },
            },
          },
        });

        if (!subject) {
          return res.status(404).json({
            success: false,
            message: "Asset not found",
          });
        }

        mode = subject.tenant?.mode || "ASSET";
      }

      const now = new Date();

      const manifest = await prisma.manifest.create({
        data: {
          studentId: studentIdNum,
          assetId: assetIdNum,
          busId: busIdNum,
          assistantId: assistantIdNum,
          latitude: cleanOptionalNumber(latitude),
          longitude: cleanOptionalNumber(longitude),
          status: statusEnum,
          session: sessionValue,
          boardingTime: statusEnum === "CHECKED_IN" ? now : null,
          alightingTime: statusEnum === "CHECKED_OUT" ? now : null,
        },
        include: {
          student: true,
          asset: true,
          bus: true,
          assistant: true,
        },
      });

      try {
        let recipientUser = null;

        if (studentIdNum) {
          recipientUser = subject?.parent?.user;
        } else {
          recipientUser = subject?.client?.user;
        }

        const recipientPhone = recipientUser?.phone;
        const recipientName = (recipientUser?.name || "Recipient").split(" ")[0];
        const subjectName = subject?.name || "Item";

        if (recipientPhone) {
          await notifyRecipient({
            recipientName,
            recipientPhone,
            subjectName,
            eventType: statusEnum,
            busNumber: bus?.plateNumber || String(bus?.id),
            session: sessionValue,
            mode,
          });
        } else {
          console.warn(
            `Missing recipient phone number for ${studentIdNum ? "student" : "asset"}: ${subjectName}`
          );
        }
      } catch (smsError) {
        console.error("SMS sending error:", smsError);
      }

      if (mode === "KID") {
        try {
          const parentPhone = subject?.parent?.user?.phone;
          const parentName = (subject?.parent?.user?.name || "Parent").split(" ")[0];

          if (parentPhone) {
            const eventType = statusEnum === "CHECKED_IN" ? "onBoard" : "offBoard";

            await notifyParent({
              parentPhone,
              parentName,
              studentName: subject.name,
              eventType,
              busNumber: bus?.plateNumber || String(bus?.id),
              session: sessionValue,
            });
          }
        } catch (legacyErr) {
          console.error("Legacy notifyParent error:", legacyErr);
        }
      }

      return res.status(201).json({
        success: true,
        message: `Manifest created successfully for ${sessionValue} session`,
        data: manifest,
      });
    } catch (error) {
      console.error("Error creating manifest:", error);
      return res.status(500).json({
        success: false,
        message: "Server error creating manifest",
        detail: error?.message,
      });
    }
  }
);

/* =========================================================
   UPDATE manifest
   ========================================================= */
router.put(
  "/:id",
  authMiddleware,
  requireRole("ADMIN", "SCHOOL", "ASSISTANT"),
  async (req, res) => {
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;

      const manifestId = parseId(req.params.id);
      if (!manifestId) {
        return res.status(400).json({
          success: false,
          message: "Invalid manifest id",
        });
      }

      const existing = await prisma.manifest.findFirst({
        where: {
          id: manifestId,
          bus: { tenantId },
        },
        select: {
          id: true,
          studentId: true,
          assetId: true,
          busId: true,
        },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Manifest not found",
        });
      }

      const payload = { ...req.body };

      if (payload.status !== undefined) {
        const statusEnum = toManifestStatus(payload.status);

        if (!statusEnum) {
          return res.status(400).json({
            success: false,
            message: "Invalid status",
          });
        }

        payload.status = statusEnum;

        const now = new Date();
        if (statusEnum === "CHECKED_IN") payload.boardingTime = now;
        if (statusEnum === "CHECKED_OUT") payload.alightingTime = now;
      }

      if (payload.session !== undefined) {
        payload.session = resolveSession(payload.session);
      }

      if (payload.busId !== undefined) {
        const busIdNum = parseId(payload.busId);

        if (!busIdNum) {
          return res.status(400).json({
            success: false,
            message: "Invalid busId",
          });
        }

        const bus = await prisma.bus.findFirst({
          where: {
            id: busIdNum,
            tenantId,
          },
          select: { id: true },
        });

        if (!bus) {
          return res.status(404).json({
            success: false,
            message: "Bus not found for this tenant",
          });
        }

        payload.busId = busIdNum;
      }

      if (payload.assistantId !== undefined) {
        const assistantIdNum = parseId(payload.assistantId);

        if (!assistantIdNum) {
          return res.status(400).json({
            success: false,
            message: "Invalid assistantId",
          });
        }

        const assistant = await prisma.user.findFirst({
          where: {
            id: assistantIdNum,
            tenantId,
            role: "ASSISTANT",
          },
          select: { id: true },
        });

        if (!assistant) {
          return res.status(404).json({
            success: false,
            message: "Assistant not found for this tenant",
          });
        }

        payload.assistantId = assistantIdNum;
      }

      if (payload.studentId !== undefined && payload.studentId !== null) {
        const studentIdNum = parseId(payload.studentId);

        if (!studentIdNum) {
          return res.status(400).json({
            success: false,
            message: "Invalid studentId",
          });
        }

        const student = await prisma.student.findFirst({
          where: {
            id: studentIdNum,
            tenantId,
          },
          select: { id: true },
        });

        if (!student) {
          return res.status(404).json({
            success: false,
            message: "Student not found for this tenant",
          });
        }

        payload.studentId = studentIdNum;
      }

      if (payload.assetId !== undefined && payload.assetId !== null) {
        const assetIdNum = parseId(payload.assetId);

        if (!assetIdNum) {
          return res.status(400).json({
            success: false,
            message: "Invalid assetId",
          });
        }

        const asset = await prisma.asset.findFirst({
          where: {
            id: assetIdNum,
            tenantId,
          },
          select: { id: true },
        });

        if (!asset) {
          return res.status(404).json({
            success: false,
            message: "Asset not found for this tenant",
          });
        }

        payload.assetId = assetIdNum;
      }

      if (payload.latitude !== undefined) {
        payload.latitude = cleanOptionalNumber(payload.latitude);
      }

      if (payload.longitude !== undefined) {
        payload.longitude = cleanOptionalNumber(payload.longitude);
      }

      if (payload.studentId !== undefined && payload.assetId !== undefined) {
        const hasStudent = !!payload.studentId;
        const hasAsset = !!payload.assetId;

        if (hasStudent === hasAsset) {
          return res.status(400).json({
            success: false,
            message: "Manifest must reference exactly one of studentId or assetId",
          });
        }
      }

      const updated = await prisma.manifest.update({
        where: { id: manifestId },
        data: payload,
        include: {
          student: true,
          asset: true,
          bus: true,
          assistant: true,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Manifest updated successfully",
        data: updated,
      });
    } catch (error) {
      console.error("Error updating manifest:", error);
      return res.status(500).json({
        success: false,
        message: "Server error updating manifest",
        detail: error?.message,
      });
    }
  }
);

/* =========================================================
   DELETE manifest
   ========================================================= */
router.delete(
  "/:id",
  authMiddleware,
  requireRole("ADMIN", "SCHOOL"),
  async (req, res) => {
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;

      const manifestId = parseId(req.params.id);
      if (!manifestId) {
        return res.status(400).json({
          success: false,
          message: "Invalid manifest id",
        });
      }

      const existing = await prisma.manifest.findFirst({
        where: {
          id: manifestId,
          bus: { tenantId },
        },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Manifest not found",
        });
      }

      await prisma.manifest.delete({
        where: { id: manifestId },
      });

      return res.status(200).json({
        success: true,
        message: "Manifest deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting manifest:", error);
      return res.status(500).json({
        success: false,
        message: "Server error deleting manifest",
        detail: error?.message,
      });
    }
  }
);

export default router;