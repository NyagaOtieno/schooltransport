// src/services/subscription.service.js

import prisma from "../middleware/prisma.js";

export const DAILY_FEE =
  Number(process.env.DAILY_SUBSCRIPTION_FEE) || 10;

const HOURS = 24;

/**
 * Check active subscription
 */
export const getActiveSubscription = async ({
  parentId = null,
  clientId = null,
  studentId = null,
  assetId = null,
}) => {
  return prisma.subscription.findFirst({
    where: {
      ...(parentId ? { parentId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(assetId ? { assetId } : {}),
      status: "ACTIVE",
      expiryDate: {
        gt: new Date(),
      },
    },
  });
};

/**
 * Activate or renew
 */
export const activateSubscription = async ({
  parentId = null,
  clientId = null,
  studentId = null,
  assetId = null,
}) => {
  const expiryDate = new Date(
    Date.now() + HOURS * 60 * 60 * 1000
  );

  // Parent → Student
  if (parentId && studentId) {
    return prisma.subscription.upsert({
      where: {
        parentId_studentId: {
          parentId,
          studentId,
        },
      },
      update: {
        status: "ACTIVE",
        expiryDate,
      },
      create: {
        parentId,
        studentId,
        status: "ACTIVE",
        type: "DAILY",
        expiryDate,
      },
    });
  }

  // Client → Asset
  if (clientId && assetId) {
    return prisma.subscription.upsert({
      where: {
        clientId_assetId: {
          clientId,
          assetId,
        },
      },
      update: {
        status: "ACTIVE",
        expiryDate,
      },
      create: {
        clientId,
        assetId,
        status: "ACTIVE",
        type: "DAILY",
        expiryDate,
      },
    });
  }

  throw new Error("Invalid subscription target");
};