// src/controllers/panicController.js
import prisma from "../middleware/prisma.js";

const ALLOWED_ROLES = ["ADMIN", "DRIVER", "ASSISTANT", "PARENT", "CLIENT", "MERCHANT"];

export async function triggerPanic(req, res) {
  try {
    const userId = req.user?.userId;
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized: missing userId" });
    if (!tenantId) return res.status(403).json({ success: false, message: "Forbidden: missing tenantId" });
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden: invalid role" });
    }

    const {
      childId,
      assetId,
      latitude,
      longitude,
      phoneNumber,
      createdBy, // optional label: e.g. "PARENT_APP", "ASSISTANT_APP"
    } = req.body;

    // ✅ Require location
    const lat = typeof latitude === "string" ? Number(latitude) : latitude;
    const lng = typeof longitude === "string" ? Number(longitude) : longitude;

    if (lat === null || lat === undefined || Number.isNaN(lat) || lng === null || lng === undefined || Number.isNaN(lng)) {
      return res.status(400).json({ success: false, message: "Location is required (latitude, longitude)" });
    }

    // ✅ Exactly one subject
    const hasChild = childId !== undefined && childId !== null && childId !== "";
    const hasAsset = assetId !== undefined && assetId !== null && assetId !== "";

    if (hasChild === hasAsset) {
      return res.status(400).json({ success: false, message: "Provide exactly one: childId OR assetId" });
    }

    // ✅ Tenant guard: ensure subject belongs to this tenant
    if (hasChild) {
      const child = await prisma.student.findFirst({
        where: { id: Number(childId), TenantId: Number(tenantId) },
        select: { id: true },
      });
      if (!child) return res.status(404).json({ success: false, message: "Student not found for this tenant" });
    }

    if (hasAsset) {
      const asset = await prisma.asset.findFirst({
        where: { id: Number(assetId), TenantId: Number(tenantId) },
        select: { id: true },
      });
      if (!asset) return res.status(404).json({ success: false, message: "Asset not found for this tenant" });
    }

    // ✅ Create panic event
    const panic = await prisma.panicEvent.create({
      data: {
        userId: Number(userId),
        tenantId: Number(tenantId),
        childId: hasChild ? Number(childId) : null,
        assetId: hasAsset ? Number(assetId) : null,
        latitude: lat,
        longitude: lng,
        phoneNumber: phoneNumber ?? null,
        role, // comes from token
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        status: "ACTIVE",
        createdBy: createdBy ?? role,
      },
      include: {
        user: { select: { id: true, name: true, phone: true, role: true } },
        child: { select: { id: true, name: true, grade: true } },
        asset: { select: { id: true, name: true, tag: true } },
        tenant: { select: { id: true, name: true, mode: true } },
      },
    });

    // OPTIONAL: notify admins / dispatch / guardians here (SMS / push)
    // await sendEmergencyAlert({ panic });

    return res.status(201).json({ success: true, message: "Panic triggered", data: panic });
  } catch (error) {
    console.error("triggerPanic error:", error);
    return res.status(500).json({ success: false, message: "Server error triggering panic" });
  }
}
