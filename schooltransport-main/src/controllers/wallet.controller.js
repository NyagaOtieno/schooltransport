import prisma from "../middleware/prisma.js";
// src/controllers/wallet.controller.js

import { BillingEngine } from "../services/billing/billing.engine.js";

/**
 * POST /api/wallet/topup
 * Body: { amount: number }
 */
export const topUp = async (req, res) => {
  try {
    const user = req.user;
    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid positive amount.",
      });
    }

    const wallet = await BillingEngine.credit({
      parentId: user.parentId ?? null,
      clientId: user.clientId ?? null,
      amount,
      reference: `topup-user-${user.id}`,
    });

    return res.status(200).json({
      success: true,
      message: "Wallet topped up successfully.",
      data: {
        balance: wallet.balance,
      },
    });
  } catch (err) {
    console.error("[wallet.topUp]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to top up wallet.",
    });
  }
};

/**
 * GET /api/wallet/balance
 */
export const balance = async (req, res) => {
  try {
    const user = req.user;

    const amount = await BillingEngine.balance({
      parentId: user.parentId ?? null,
      clientId: user.clientId ?? null,
    });

    return res.status(200).json({
      success: true,
      data: {
        balance: amount,
      },
    });
  } catch (err) {
    console.error("[wallet.balance]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve wallet balance.",
    });
  }
};
/**
 * GET /api/wallet/transactions
 * Returns paginated transaction history for the authenticated user's wallet.
 */
export const transactions = async (req, res) => {
  try {
    const user   = req.user;
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(50, Number(req.query.limit) || 20);

    // Find the wallet for this parent/client
    const wallet = await prisma.wallet.findFirst({
      where: {
        OR: [
          { parent: { userId: user.userId } },
          { client: { userId: user.userId } },
        ],
      },
    });

    if (!wallet) {
      return res.json({ success: true, data: [], page, limit });
    }

    const txs = await prisma.transaction.findMany({
      where:   { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
    });

    return res.json({ success: true, data: txs, page, limit });
  } catch (err) {
    console.error("[wallet.transactions]", err);
    return res.status(500).json({ success: false, message: "Failed to retrieve transactions." });
  }
};