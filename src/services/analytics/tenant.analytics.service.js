import prisma from "../../middleware/prisma.js";

/**
 * TENANT DASHBOARD SUMMARY
 */
export const getTenantSummary = async (tenantId) => {
  const [students, buses, subscriptions, revenue] = await Promise.all([
    prisma.student.count({ where: { tenantId } }),
    prisma.bus.count({ where: { tenantId } }),
    prisma.subscription.count({
      where: {
        OR: [
          { client: { tenantId } },
          { parent: { tenantId } },
        ],
      },
    }),
    prisma.transaction.aggregate({
      where: {
        client: { tenantId },
        type: "DEDUCTION",
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    students,
    buses,
    activeSubscriptions: subscriptions,
    revenue: revenue._sum.amount || 0,
  };
};