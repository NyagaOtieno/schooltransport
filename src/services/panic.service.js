// src/services/panic.service.js
import prisma from "../middleware/prisma.js";
import { sendEmergencyAlert } from "./notification.service.js";

export async function createPanicEvent({
  userId,
  phoneNumber, // (kept, but parent phone will be used for alert)
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

  if (
    lat === null || lat === undefined || Number.isNaN(lat) ||
    lng === null || lng === undefined || Number.isNaN(lng)
  ) {
    throw new Error("Location is required");
  }

  if (!childId) throw new Error("childId is required");

  const safeRole = ["ADMIN","DRIVER","ASSISTANT","PARENT","CLIENT","MERCHANT"].includes(role)
  ? role
  : "PARENT";


  // 1) Cooldown check
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

  // 2) Fetch student + parent phone
  const student = await prisma.student.findUnique({
    where: { id: Number(childId) },
    include: {
      parent: { include: { user: true } }, // parent -> user -> phone
      bus: true,
      school: true,
    },
  });

  if (!student) {
    throw new Error("Invalid childId. Student not found.");
  }

  const parentPhone = student?.parent?.user?.phone || null;

  // 3) Save panic event
  const panicEvent = await prisma.panicEvent.create({
    data: {
      userId,
      childId: Number(childId),
      latitude: lat,
      longitude: lng,
      phoneNumber: parentPhone || phoneNumber || null, // store something useful
      role: safeRole,
      createdBy: createdBy || "SYSTEM",
      status: "ACTIVE",
      ipAddress,
      userAgent,
    },
  });

  // 4) Send SMS to parent
  const studentName = student?.name || "your child";
  const busPlate = student?.bus?.plateNumber || "N/A";
  const schoolName = student?.school?.name || "School";
  const mapLink = `https://maps.google.com/?q=${lat},${lng}`;

  if (parentPhone) {
    await sendEmergencyAlert({
      phone: parentPhone,
      name: createdBy || "Staff",
      location: `${schoolName} | ${studentName} | Bus ${busPlate} | ${mapLink}`,
    });
  } else {
    // If parent phone missing, keep the panic saved but log it
    console.warn(
      `⚠️ Panic saved but parent phone missing for studentId=${childId} (panicId=${panicEvent.id})`
    );
  }

  return panicEvent;
}
