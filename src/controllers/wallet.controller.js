// src/controllers/Wallet.controller.js
import prisma from "../middleware/prisma.js";
import {
  creditWallet, getWallet,
  creditAgentWallet, getAgentWallet, getOrCreateAgentWallet,
  getParentByUserId, getClientByUserId, getAgentByUserId,
} from "../services/wallet.service.js";

/* ============================================================
   HELPER — resolve owner from JWT user (all 3 roles)
============================================================ */
const resolveOwner = async (user) => {
  const role = user?.role?.toUpperCase();

  if (role === "PARENT") {
    const parent = await getParentByUserId(user.id);
    return parent ? { type: "wallet", parentId: parent.id, clientId: null } : null;
  }
  if (role === "CLIENT") {
    const client = await getClientByUserId(user.id);
    return client ? { type: "wallet", parentId: null, clientId: client.id } : null;
  }
  if (role === "AGENT") {
    const agent = await getAgentByUserId(user.id);
    return agent ? { type: "agentWallet", agentId: agent.id } : null;
  }
  return null;
};

/* ============================================================
   POST /api/wallet/topup
   Manual top-up (admin-credited / no M-Pesa).
   For M-Pesa top-up use POST /api/mpesa/stk-push instead.
   Body: { amount: number }
============================================================ */
export const topUp = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Provide a valid positive amount." });
    }

    const owner = await resolveOwner(req.user);
    if (!owner) {
      return res.status(403).json({ success: false, message: "Only PARENT, CLIENT or AGENT accounts can top up." });
    }

    let wallet;

    if (owner.type === "agentWallet") {
      // ── Agent wallet ────────────────────────────────────
      wallet = await creditAgentWallet({
        agentId:     owner.agentId,
        amount,
        type:        "TOPUP",
        description: `Manual top-up`,
        reference:   `manual-${req.user.id}-${Date.now()}`,
      });
    } else {
      // ── Parent / Client wallet ───────────────────────────
      wallet = await creditWallet({
        parentId:  owner.parentId ?? null,
        clientId:  owner.clientId ?? null,
        amount,
        reference: `manual-${req.user.id}-${Date.now()}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Wallet topped up successfully.",
      balance: wallet.balance,
    });
  } catch (err) {
    console.error("[wallet.topUp]", err);
    return res.status(500).json({ success: false, message: "Top-up failed. Please try again." });
  }
};

/* ============================================================
   GET /api/wallet/balance
============================================================ */
export const balance = async (req, res) => {
  try {
    const owner = await resolveOwner(req.user);
    if (!owner) {
      return res.status(403).json({ success: false, message: "Only PARENT, CLIENT or AGENT accounts have wallets." });
    }

    let bal = 0;
    if (owner.type === "agentWallet") {
      const w = await getAgentWallet(owner.agentId);
      bal = w.balance;
    } else {
      const w = await getWallet({ parentId: owner.parentId ?? null, clientId: owner.clientId ?? null });
      bal = w.balance;
    }

    return res.status(200).json({ success: true, balance: bal });
  } catch (err) {
    console.error("[wallet.balance]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch balance." });
  }
};

/* ============================================================
   GET /api/wallet/transactions?page=1&limit=20
============================================================ */
export const transactions = async (req, res) => {
  try {
    const owner = await resolveOwner(req.user);
    if (!owner) {
      return res.status(403).json({ success: false, message: "Only PARENT, CLIENT or AGENT accounts have wallets." });
    }

    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    let txs = [], total = 0;

    if (owner.type === "agentWallet") {
      // Agent transactions from AgentWallet
      const wallet = await getAgentWallet(owner.agentId);
      if (!wallet.id) return res.status(200).json({ success: true, data: [], total: 0, page, limit });

      [txs, total] = await Promise.all([
        prisma.agentTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, skip, take: limit }),
        prisma.agentTransaction.count({ where: { walletId: wallet.id } }),
      ]);
    } else {
      // Parent / Client transactions
      const wallet = await getWallet({ parentId: owner.parentId ?? null, clientId: owner.clientId ?? null });
      if (!wallet.id) return res.status(200).json({ success: true, data: [], total: 0, page, limit });

      [txs, total] = await Promise.all([
        prisma.transaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, skip, take: limit }),
        prisma.transaction.count({ where: { walletId: wallet.id } }),
      ]);
    }

    return res.status(200).json({ success: true, data: txs, total, page, limit });
  } catch (err) {
    console.error("[wallet.transactions]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch transactions." });
  }
};