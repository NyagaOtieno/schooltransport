// src/state/billing.state.js
// Shared in-memory maps used by both agent.controller and mpesa.controller.
// Keeping them here breaks the circular import that was causing the 500 error.

/**
 * Maps CheckoutRequestID → onboarding fee context
 * { agentId, agentWalletId, tenantId, amount }
 * Set by agent.controller after school creation + STK push.
 * Read + cleared by mpesa.controller in stkCallback.
 */
export const pendingOnboarding = new Map();

/**
 * Maps CheckoutRequestID → regular wallet top-up context
 * { walletType, walletId|agentWalletId, transactionId|agentTxId, ... }
 * Set and read by mpesa.controller only.
 */
export const pendingSTK = new Map();