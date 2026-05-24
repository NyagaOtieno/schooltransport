// src/services/wallet.service.js
import prisma from "../middleware/prisma.js";

/* ============================================================
   HELPERS — resolve parent/client record from userId
   Required by Wallet.controller.js
============================================================ */

/**
 * Resolve the Parent record for a given userId.
 * Returns null if the user has no parent profile.
 */
export const getParentByUserId = async (userId) => {
  return prisma.parent.findFirst({ where: { userId } });
};

/**
 * Resolve the Client record for a given userId.
 * Returns null if the user has no client profile.
 */
export const getClientByUserId = async (userId) => {
  return prisma.client.findFirst({ where: { userId } });
};

export const getAgentByUserId = async (userId) => {
  return prisma.agent.findFirst({ where: { userId } });
};
/* ============================================================
   WALLET READ
============================================================ */

/**
 * Fetch a wallet by parentId or clientId.
 * Returns { id: null, balance: 0 } if no wallet exists yet.
 */
export const getWallet = async ({ parentId = null, clientId = null, agentId = null }) => {
  const wallet = await prisma.wallet.findFirst({
    where: {
      OR: [
        parentId ? { parentId } : null,
        clientId ? { clientId } : null,
        agentId ? { agentId } : null,
      ].filter(Boolean),
    },
  });

  return wallet ?? { id: null, balance: 0 };
};

/**
 * Return only the numeric balance.
 */
export const getBalance = async ({ parentId = null, clientId = null, agentId = null }) => {
  const wallet = await getWallet({ parentId, clientId, agentId });
  return wallet.balance;
};

/* ============================================================
   CREDIT WALLET (top-up)
   TransactionType enum value: DEPOSIT
============================================================ */

/**
 * Credit a wallet. Creates wallet automatically on first top-up.
 * Logs a DEPOSIT transaction.
 *
 * @param {{ parentId?: number, clientId?: number, amount: number, reference?: string }}
 * @returns updated Wallet record
 */
export const creditWallet = async ({
  parentId = null,
  clientId = null,
  agentId = null,
  amount,
  reference = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Credit amount must be greater than zero.");
  }

  const whereClause = parentId ? { parentId } : { clientId };

  return prisma.$transaction(async (tx) => {
    // Upsert: create wallet on first top-up, increment on subsequent ones
    const wallet = await tx.wallet.upsert({
      where: whereClause,
      update: { balance: { increment: amount } },
      create: {
        parentId: parentId ?? null,
        clientId: clientId ?? null,
        agentId: agentId ?? null,
        balance: amount,
      },
    });

    await tx.transaction.create({
      data: {
        walletId:  wallet.id,
        parentId:  parentId ?? null,
        clientId:  clientId ?? null,
        agentId:   agentId ?? null,
        amount,
        type:      "DEPOSIT",    // ✅ fixed: was "CREDIT" — enum is DEPOSIT/DEDUCTION
        status:    "SUCCESS",
        reference: reference ?? null,
      },
    });

    return wallet;
  });
};

/* ============================================================
   DEDUCT WALLET
   TransactionType enum value: DEDUCTION
============================================================ */

/**
 * Deduct from a wallet. Throws a coded error if balance is insufficient.
 * Uses a Prisma transaction to prevent race conditions.
 *
 * Error codes:
 *   WALLET_NOT_FOUND      — wallet doesn't exist (user hasn't topped up yet)
 *   INSUFFICIENT_BALANCE  — balance is less than the requested amount
 *
 * @param {{ parentId?: number, clientId?: number, amount: number, reference?: string }}
 * @returns updated Wallet record
 */
export const deductWallet = async ({
  parentId = null,
  clientId = null,
  agentId = null,
  amount,
  reference = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Deduction amount must be greater than zero.");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: {
        OR: [
          parentId ? { parentId } : null,
          clientId ? { clientId } : null,
          agentId ? { agentId } : null,
        ].filter(Boolean),
      },
    });

    if (!wallet) {
      const err = new Error("Wallet not found. Please top up your wallet to continue.");
      err.code = "WALLET_NOT_FOUND";
      throw err;
    }

    if (wallet.balance < amount) {
      const err = new Error("Insufficient wallet balance. Please top up to continue.");
      err.code = "INSUFFICIENT_BALANCE";
      err.currentBalance = wallet.balance;
      throw err;
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId:  wallet.id,
        parentId:  parentId ?? null,
        clientId:  clientId ?? null,
        agentId:   agentId ?? null,
        amount,
        type:      "DEDUCTION",  // ✅ fixed: was "DEBIT" — enum is DEPOSIT/DEDUCTION
        status:    "SUCCESS",
        reference: reference ?? null,
      },
    });

    return updated;
  });
};