// src/controllers/Wallet.controller.js
import {
  creditWallet,
  deductWallet,
  getWallet,
  getParentByUserId,   // ✅ now exported from wallet.service.js
  getClientByUserId,   // ✅ now exported from wallet.service.js
} from "../services/wallet.service.js";
import prisma from "../middleware/prisma.js";

/* ============================================================
   HELPER — resolve wallet owner from the JWT user
============================================================ */

const resolveOwner = async (user) => {
  const role = user?.role?.toUpperCase();

  if (role === "PARENT") {
    const parent = await getParentByUserId(user.id);
    if (!parent) return null;
    return { parentId: parent.id, clientId: null, agentId: null };
  }

  if (role === "CLIENT") {
    const client = await getClientByUserId(user.id);
    if (!client) return null;
    return { parentId: null, clientId: client.id, agentId: null };
  }
  if (role === "AGENT") {
    const agent = await getAgentByUserId(user.id);
    if (!agent) return null;
    return { parentId: null, clientId: null, agentId: agent.id };
  }
  return null; // ADMIN, DRIVER,  etc. have no wallet
};

/* ============================================================
   POST /api/wallet/topup
   Body: { amount: number }
============================================================ */

export const topUp = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid positive amount.",
      });
    }

    const owner = await resolveOwner(req.user);

    if (!owner) {
      return res.status(403).json({
        success: false,
        message: "Only PARENT, AGENT or CLIENT accounts can top up a wallet.",
      });
    }

    const wallet = await creditWallet({
      ...owner,
      amount,
      reference: `topup-${req.user.id}-${Date.now()}`,
    });

    return res.status(200).json({
      success: true,
      message: "Wallet topped up successfully.",
      balance: wallet.balance,
    });
  } catch (err) {
    console.error("[wallet.topUp]", err);
    return res.status(500).json({
      success: false,
      message: "Wallet top-up failed. Please try again.",
    });
  }
};

/* ============================================================
   GET /api/wallet/balance
============================================================ */

export const balance = async (req, res) => {
  try {
    const owner = await resolveOwner(req.user);

    if (!owner) {
      return res.status(403).json({
        success: false,
        message: "Only PARENT, AGENT or CLIENT accounts have wallets.",
      });
    }

    const wallet = await getWallet(owner);

    return res.status(200).json({
      success: true,
      balance: wallet.balance,
    });
  } catch (err) {
    console.error("[wallet.balance]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet balance.",
    });
  }
};

/* ============================================================
   GET /api/wallet/transactions
   Query: ?page=1&limit=20
============================================================ */

export const transactions = async (req, res) => {
  try {
    const owner = await resolveOwner(req.user);

    if (!owner) {
      return res.status(403).json({
        success: false,
        message: "Only PARENT, AGENT or CLIENT accounts have wallets.",
      });
    }

    // Find the wallet first so we can query its transactions
    const wallet = await getWallet(owner);

    if (!wallet.id) {
      // No wallet yet — return empty list, not an error
      return res.status(200).json({
        success: true,
        data: [],
        page: 1,
        limit: 20,
        total: 0,
      });
    }

    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const [txs, total] = await Promise.all([
      prisma.transaction.findMany({
        where:   { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.transaction.count({ where: { walletId: wallet.id } }),
    ]);

    return res.status(200).json({
      success: true,
      data:  txs,
      page,
      limit,
      total,
    });
  } catch (err) {
    console.error("[wallet.transactions]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions.",
    });
  }
};