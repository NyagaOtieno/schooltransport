import prisma from "../../middleware/prisma.js";

/**
 * MOST USED BILLABLE FEATURES
 */
export const getTopFeatures = async () => {
  const transactions = await prisma.transaction.findMany({
    where: {
      type: "DEDUCTION",
    },
    select: {
      reference: true,
      amount: true,
    },
  });

  const map = {};

  for (const t of transactions) {
    const feature = t.reference?.split("-")[0] || "unknown";
    map[feature] = (map[feature] || 0) + t.amount;
  }

  return Object.entries(map)
    .map(([feature, revenue]) => ({ feature, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
};