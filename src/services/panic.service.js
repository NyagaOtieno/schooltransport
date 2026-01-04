// src/services/panic.service.js
import prisma from "../middleware/prisma.js"; // your existing Prisma client
import { sendEmergencyAlert } from "./notification.service.js";

/**
 * Create a panic event and send SMS
 */
export async function createPanicEvent({
  userId,
  phoneNumber,
  role = "USER",
  ipAddress,
  userAgent,
}) {
  // 1️⃣ Save panic event to database using Prisma
const panicEvent = await prisma.panicEvent.create({
  data: {
    userId,
    childId,
    latitude,
    longitude,
    createdBy, 
    status: "ACTIVE",
  },
});


  // 2️⃣ Trigger SMS via your existing notification service
  await sendEmergencyAlert({
    phoneNumber,
    panicId: panicEvent.id,
    userId,
  });

  return panicEvent;
}
const recentPanic = await prisma.panicEvent.findFirst({
  where: {
    userId,
    createdAt: { gte: new Date(Date.now() - 60 * 1000) }
  }
});

if (recentPanic) {
  throw new Error("Panic cooldown active");
}
