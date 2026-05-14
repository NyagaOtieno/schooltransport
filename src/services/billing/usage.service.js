import { BillingEngine } from "./billing.engine.js";

const COST_MAP = {
  TRACKING_REQUEST: 1,
  LIVE_LOCATION: 2,
  PANIC_ALERT: 0,
};

export const chargeUsage = async ({
  parentId,
  clientId,
  feature,
  reference,
}) => {
  const cost = COST_MAP[feature] ?? 0;

  if (cost === 0) return true;

  await BillingEngine.debit({
    parentId,
    clientId,
    amount: cost,
    reference: reference || feature,
  });

  return true;
};