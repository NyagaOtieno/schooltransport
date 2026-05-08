import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const DAILY_FEE = Number(process.env.DAILY_SUBSCRIPTION_FEE) || 10;
const SUBSCRIPTION_DURATION_HOURS = 24;

export const getActiveSubscription = async ({ userId, studentId = null, assetId = null }) => {
  const now = new Date();

  const whereClause = {
    userId,
    status: "ACTIVE",
    expiresAt: { gt: now },
  };

  if (studentId) whereClause.studentId = studentId;
  if (assetId) whereClause.assetId = assetId;

  return await prisma.subscription.findFirst({
    where: whereClause,
    orderBy: { expiresAt: "desc" },
  });
};

export const activateSubscription = async ({ userId, studentId = null, assetId = null }) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DURATION_HOURS * 60 * 60 * 1000);

  const existing = await prisma.subscription.findFirst({
    where: {
      userId,
      ...(studentId ? { studentId } : {}),
      ...(assetId ? { assetId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        startedAt: now,
        expiresAt,
      },
    });
  }

  return await prisma.subscription.create({
    data: {
      userId,
      studentId: studentId || null,
      assetId: assetId || null,
      status: "ACTIVE",
      type: "DAILY",
      startedAt: now,
      expiresAt,
    },
  });
};