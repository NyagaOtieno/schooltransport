import { getTotalRevenue, getDailyRevenue } from "../services/analytics/revenue.service.js";
import { getTopFeatures } from "../services/analytics/usage.analytics.service.js";
import { getTenantSummary } from "../services/analytics/tenant.analytics.service.js";

/**
 * GET /api/analytics/platform
 */
export const platformAnalytics = async (req, res) => {
  try {
    const totalRevenue = await getTotalRevenue();
    const daily = await getDailyRevenue();
    const topFeatures = await getTopFeatures();

    return res.json({
      success: true,
      data: {
        totalRevenue,
        dailyRevenue: daily,
        topFeatures,
      },
    });
  } catch (err) {
    console.error("[analytics.platform]", err);
    res.status(500).json({ success: false });
  }
};

/**
 * GET /api/analytics/tenant/:tenantId
 */
export const tenantAnalytics = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);

    const data = await getTenantSummary(tenantId);
    const revenue = await getRevenueByTenant(tenantId);

    return res.json({
      success: true,
      data: {
        ...data,
        revenue,
      },
    });
  } catch (err) {
    console.error("[analytics.tenant]", err);
    res.status(500).json({ success: false });
  }
};