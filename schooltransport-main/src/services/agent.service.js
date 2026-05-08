// src/services/agent.service.js
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

/**
 * Get or create an AgentWallet for a given agentId.
 */
export async function getOrCreateAgentWallet(agentId) {
  let wallet = await prisma.agentWallet.findUnique({ where: { agentId } });
  if (!wallet) {
    wallet = await prisma.agentWallet.create({
      data: { agentId, balance: 0 },
    });
  }
  return wallet;
}

/**
 * Credit an agent's wallet.
 */
export async function creditAgentWallet(agentId, amount, description = "Top-up") {
  if (!amount || amount <= 0) throw new Error("Amount must be positive.");
  const wallet = await getOrCreateAgentWallet(agentId);

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.agentWallet.update({
      where: { agentId },
      data: { balance: { increment: amount } },
    });
    await tx.agentTransaction.create({
      data: {
        walletId:     wallet.id,
        type:         "TOPUP",
        amount,
        description,
        balanceBefore: wallet.balance,
        balanceAfter:  wallet.balance + amount,
        reference:     `topup-agent-${agentId}-${Date.now()}`,
      },
    });
    return updated;
  });
}

/**
 * Deduct from an agent's wallet.
 */
export async function deductAgentWallet(agentId, amount, type = "WITHDRAWAL", description = "") {
  if (!amount || amount <= 0) throw new Error("Amount must be positive.");
  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.agentWallet.findUnique({ where: { agentId } });
    if (!wallet) throw Object.assign(new Error("Agent wallet not found."), { code: "WALLET_NOT_FOUND" });
    if (wallet.balance < amount) throw Object.assign(new Error("Insufficient balance."), { code: "INSUFFICIENT_BALANCE" });

    const updated = await tx.agentWallet.update({
      where: { agentId },
      data: { balance: { decrement: amount } },
    });
    await tx.agentTransaction.create({
      data: {
        walletId:     wallet.id,
        type,
        amount,
        description,
        balanceBefore: wallet.balance,
        balanceAfter:  wallet.balance - amount,
        reference:     `${type.toLowerCase()}-agent-${agentId}-${Date.now()}`,
      },
    });
    return updated;
  });
}

/**
 * Add commission to agent when a school's subscription is paid.
 * Called by the billing engine.
 */
export async function creditAgentCommission(tenantId, subscriptionAmount) {
  // Find which agent manages this school
  const agentTenant = await prisma.agentTenant.findFirst({
    where: { tenantId },
    include: { agent: true },
  });
  if (!agentTenant) return null;

  const commission = subscriptionAmount * agentTenant.agent.commissionRate;
  await creditAgentWallet(
    agentTenant.agent.id,
    commission,
    `Commission for tenant #${tenantId}`
  );
  return commission;
}

/**
 * Full agent profile include block.
 */
export const agentInclude = {
  user:    { select: { id: true, name: true, email: true, phone: true, role: true } },
  wallet:  true,
  tenants: {
    include: {
      tenant: {
        select: {
          id: true, name: true, mode: true, createdAt: true,
          _count: { select: { students: true, users: true, buses: true } },
        },
      },
    },
  },
};