import prisma from "../middleware/prisma.js";
import { sendEmergencyAlert } from "./notification.service.js";

/**
 * Create a panic event and send SMS
 * Accepts: userId, phoneNumber, role, latitude, longitude, childId, createdBy, ipAddress, userAgent
 */
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
  if (!latitude || !longitude) throw new Error("Location is required");
  if (!childId) throw new Error("childId is required");

  // 1️⃣ Cooldown check: prevent multiple panics within 60 seconds
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

  // 2️⃣ Save panic event to database
  const panicEvent = await prisma.panicEvent.create({
    data: {
      userId,
      childId,
      latitude,
      longitude,
      createdBy: createdBy || "SYSTEM",
      status: "ACTIVE",
      ipAddress,
      userAgent,
    },
  });

  // 3️⃣ Trigger emergency alert (SMS/email/etc)
  await sendEmergencyAlert({
    phoneNumber,
    panicId: panicEvent.id,
    userId,
  });

  return panicEvent;
}
