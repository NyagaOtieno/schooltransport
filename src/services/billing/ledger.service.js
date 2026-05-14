// src/services/billing/ledger.service.js
import prisma from "../../middleware/prisma.js";

/**
 * ENTERPRISE LEDGER SYSTEM
 * - transaction-safe
 * - audit-ready
 * - future Mpesa + refunds compatible
 */
export const createLedgerEntry = async ({
  tx = prisma, // allows transaction injection
  walletId,
  parentId = null,
  clientId = null,
  type, // CREDIT | DEBIT | REFUND | ADJUSTMENT
  amount,
  reference,
  balanceBefore,
  balanceAfter,
  metadata = {},
}) => {
  if (!walletId || !amount || amount <= 0) {
    throw new Error("Invalid ledger entry: missing walletId or amount");
  }

  return await tx.transaction.create({
    data: {
      walletId,
      parentId,
      clientId,
      amount,
      type,
      status: "SUCCESS",
      reference,
      metadata,
    },
  });
};