// src/services/panic.service.js
import prisma from "../middleware/prisma.js";
import { sendEmergencyAlert } from "./notification.service.js";

export async function createPanicEvent({
  userId,
  phoneNumber,
  role = "USER",
  latitude,
  longitude,
  childId,
  createdBy,
  ipAddress,
  userAgent,
}) {
  if (!userId) throw new Error("userId is required");

  const lat = typeof latitude === "string" ? Number(latitude) : latitude;
  const lng = typeof longitude === "string" ? Number(longitude) : longitude;

  if (lat === null || lat === undefined || Number.isNaN(lat) || lng === null || lng === undefined || Number.isNaN(lng)) {
    throw new Error("Location is required");
  }

  if (!childId) throw new Error("childId is required");

  const safeRole = ["ADMIN","DRIVER","ASSISTANT","PARENT"].includes(role) ? role : "PARENT";

  const recentPanic = await prisma.panicEvent.findFirst({
    where: {
      userId,
      createdAt: { gte: new Date(Date.now() - 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentPanic) {
    throw new Error("Panic cooldown active");
  }

  const panicEvent = await prisma.panicEvent.create({
    data: {
      userId,
      childId,
      latitude: lat,
      longitude: lng,
      phoneNumber: phoneNumber || null,
      role: safeRole,
      createdBy: createdBy || "SYSTEM",
      status: "ACTIVE",
      ipAddress,
      userAgent,
    },
  });

  await sendEmergencyAlert({
    phone: phoneNumber,
    name: createdBy || "User",
    location: `https://maps.google.com/?q=${lat},${lng}`,
  });

  return panicEvent;
}
