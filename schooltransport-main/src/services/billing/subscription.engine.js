import prisma from "../../middleware/prisma.js";
import { BillingEngine } from "./billing.engine.js";

/**
 * DEFAULT PRICING (can later move to DB)
 */
const PRICING = {
  DAILY: 10,
  WEEKLY: 50,
  MONTHLY: 150,
};

/**
 * Create or renew subscription
 */
export const renewSubscription = async ({
  parentId = null,
  clientId = null,
  studentId = null,
  assetId = null,
  type = "DAILY",
}) => {
  const amount = PRICING[type];

  if (!amount) throw new Error("Invalid subscription type");

  // 1. Charge wallet first
  await BillingEngine.debit({
    parentId,
    clientId,
    amount,
    reference: `subscription-${type}`,
  });

  // 2. Set expiry
  const expiryMap = {
    DAILY: 24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
    MONTHLY: 30 * 24 * 60 * 60 * 1000,
  };

  const expiryDate = new Date(Date.now() + expiryMap[type]);

  // 3. Upsert subscription
  return prisma.subscription.upsert({
    where: parentId
      ? { parentId_studentId: { parentId, studentId } }
      : { clientId_assetId: { clientId, assetId } },

    update: {
      status: "ACTIVE",
      expiryDate,
      type,
    },

    create: {
      parentId,
      clientId,
      studentId,
      assetId,
      status: "ACTIVE",
      type,
      expiryDate,
    },
  });
};

/**
 * AUTO RENEW CHECKER (used by cron)
 */
export const autoRenewSubscriptions = async () => {
  const expiring = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      expiryDate: {
        lt: new Date(Date.now() + 60 * 60 * 1000), // expiring in 1h
      },
    },
  });

  for (const sub of expiring) {
    try {
      await renewSubscription(sub);
    } catch (err) {
      console.error("Auto-renew failed:", sub.id, err.message);
    }
  }
};