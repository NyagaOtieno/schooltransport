import { chargeUsage } from "../services/billing/usage.service.js";

/**
 * Auto-bill API usage
 */
export const billUsage = (feature) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      const parentId = user?.parentId ?? null;
      const clientId = user?.clientId ?? null;

      await chargeUsage({
        parentId,
        clientId,
        feature,
        reference: `${feature}-${Date.now()}`,
      });

      next();
    } catch (err) {
      if (err.code === "INSUFFICIENT_FUNDS") {
        return res.status(402).json({
          success: false,
          message: "Insufficient balance. Please top up.",
        });
      }

      console.error("[Billing Middleware]", err);
      return res.status(500).json({
        success: false,
        message: "Billing error",
      });
    }
  };
};