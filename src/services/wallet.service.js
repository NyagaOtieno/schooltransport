// src/services/wallet.service.js
import prisma from "../middleware/prisma.js";

/* ============================================================
   PROFILE RESOLVERS
============================================================ */
export const getParentByUserId = async (userId) =>
  prisma.parent.findFirst({ where: { userId } });

export const getClientByUserId = async (userId) =>
  prisma.client.findFirst({ where: { userId } });

export const getAgentByUserId = async (userId) =>
  prisma.agent.findFirst({ where: { userId }, include: { wallet: true } });

/* ============================================================
   PARENT / CLIENT  →  Wallet + Transaction
============================================================ */
export const getWallet = async ({ parentId = null, clientId = null }) => {
  const wallet = await prisma.wallet.findFirst({
    where: {
      OR: [
        parentId ? { parentId } : null,
        clientId ? { clientId } : null,
      ].filter(Boolean),
    },
  });
  return wallet ?? { id: null, balance: 0 };
};

export const creditWallet = async ({ parentId = null, clientId = null, amount, reference = null }) => {
  if (!amount || amount <= 0) throw new Error("Credit amount must be greater than zero.");
  const whereClause = parentId ? { parentId } : { clientId };

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where:  whereClause,
      update: { balance: { increment: amount } },
      create: { parentId: parentId ?? null, clientId: clientId ?? null, balance: amount },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id, parentId: parentId ?? null, clientId: clientId ?? null,
        amount, type: "DEPOSIT", status: "SUCCESS", reference: reference ?? null,
      },
    });
    return wallet;
  });
};

export const deductWallet = async ({ parentId = null, clientId = null, amount, reference = null }) => {
  if (!amount || amount <= 0) throw new Error("Deduction amount must be greater than zero.");

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: {
        OR: [
          parentId ? { parentId } : null,
          clientId ? { clientId } : null,
        ].filter(Boolean),
      },
    });

    if (!wallet) {
      const err = new Error("Wallet not found. Please top up to continue.");
      err.code = "WALLET_NOT_FOUND"; throw err;
    }
    if (wallet.balance < amount) {
      const err = new Error("Insufficient wallet balance. Please top up to continue.");
      err.code = "INSUFFICIENT_BALANCE"; err.currentBalance = wallet.balance; throw err;
    }

    const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } });
    await tx.transaction.create({
      data: {
        walletId: wallet.id, parentId: parentId ?? null, clientId: clientId ?? null,
        amount, type: "DEDUCTION", status: "SUCCESS", reference: reference ?? null,
      },
    });
    return updated;
  });
};

/* ============================================================
   AGENT  →  AgentWallet + AgentTransaction
============================================================ */
export const getAgentWallet = async (agentId) =>
  (await prisma.agentWallet.findUnique({ where: { agentId } })) ?? { id: null, balance: 0 };

export const getOrCreateAgentWallet = async (agentId) => {
  let w = await prisma.agentWallet.findUnique({ where: { agentId } });
  if (!w) w = await prisma.agentWallet.create({ data: { agentId, balance: 0 } });
  return w;
};

export const creditAgentWallet = async ({ agentId, amount, type = "TOPUP", description = "Top-up", reference = null }) => {
  if (!amount || amount <= 0) throw new Error("Credit amount must be greater than zero.");

  return prisma.$transaction(async (tx) => {
    const before = await tx.agentWallet.findUnique({ where: { agentId } });
    const balanceBefore = before?.balance ?? 0;

    const wallet = await tx.agentWallet.upsert({
      where:  { agentId },
      update: { balance: { increment: amount } },
      create: { agentId, balance: amount },
    });

    await tx.agentTransaction.create({
      data: {
        walletId: wallet.id, type, amount, description,
        reference: reference ?? null,
        balanceBefore,
        balanceAfter: balanceBefore + amount,
      },
    });
    return wallet;
  });
};

export const deductAgentWallet = async ({ agentId, amount, description = "Withdrawal", reference = null }) => {
  if (!amount || amount <= 0) throw new Error("Deduction amount must be greater than zero.");

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.agentWallet.findUnique({ where: { agentId } });
    if (!wallet) { const e = new Error("Agent wallet not found."); e.code = "WALLET_NOT_FOUND"; throw e; }
    if (wallet.balance < amount) {
      const e = new Error("Insufficient agent wallet balance.");
      e.code = "INSUFFICIENT_BALANCE"; e.currentBalance = wallet.balance; throw e;
    }
    const updated = await tx.agentWallet.update({ where: { agentId }, data: { balance: { decrement: amount } } });
    await tx.agentTransaction.create({
      data: {
        walletId: wallet.id, type: "WITHDRAWAL", amount, description,
        reference: reference ?? null, balanceBefore: wallet.balance, balanceAfter: wallet.balance - amount,
      },
    });
    return updated;
  });
};