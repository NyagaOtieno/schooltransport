import prisma from "../../middleware/prisma.js";

/**
 * TOTAL PLATFORM REVENUE
 * (All money deducted from wallets)
 */
export const getTotalRevenue = async () => {
  const result = await prisma.transaction.aggregate({
    where: {
      type: "DEDUCTION",
      status: "SUCCESS",
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount || 0;
};

/**
 * REVENUE BY TENANT
 * (All deductions linked to a tenant via client)
 */
export const getRevenueByTenant = async (tenantId) => {
  const result = await prisma.transaction.aggregate({
    where: {
      type: "DEDUCTION",
      status: "SUCCESS",
      client: {
        tenantId,
      },
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount || 0;
};

/**
 * DAILY REVENUE TREND (LAST 7 DAYS)
 */
export const getDailyRevenue = async () => {
  const last7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const transactions = await prisma.transaction.findMany({
    where: {
      type: "DEDUCTION",
      status: "SUCCESS",
      createdAt: { gte: last7 },
    },
    select: {
      amount: true,
      createdAt: true,
    },
  });

  const map = {};

  for (const t of transactions) {
    const day = new Date(t.createdAt).toISOString().split("T")[0];
    map[day] = (map[day] || 0) + t.amount;
  }

  return Object.entries(map).map(([date, total]) => ({
    date,
    total,
  }));
};