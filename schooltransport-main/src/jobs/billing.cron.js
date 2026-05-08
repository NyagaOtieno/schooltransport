// src/jobs/billing.cron.js
import cron from "node-cron";
import { autoRenewSubscriptions } from "../services/billing/subscription.engine.js";

let isRunning = false;

/**
 * BILLING CRON (SAFE MODE)
 * Prevents overlapping executions
 */
export const startBillingCron = () => {
  cron.schedule("*/30 * * * *", async () => {
    if (isRunning) {
      console.log("⏳ Billing job already running — skipping...");
      return;
    }

    isRunning = true;

    try {
      console.log("🔄 Running subscription billing engine...");

      const result = await autoRenewSubscriptions();

      console.log("✅ Billing cycle complete:", {
        processed: result?.processed || 0,
        failed: result?.failed || 0,
      });
    } catch (err) {
      console.error("❌ Billing cron error:", err.message);
    } finally {
      isRunning = false;
    }
  });
};