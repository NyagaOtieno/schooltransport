// src/controllers/wallet.controller.js

import {
  creditWallet,
  getClientByUserId,
  getParentByUserId,
  getWallet,
} from "../services/wallet.service.js";

const resolveOwner = async (user) => {
  if (user.role === "PARENT") {
    const parent =
      await getParentByUserId(user.id);

    if (!parent) return null;

    return {
      parentId: parent.id,
      clientId: null,
    };
  }

  if (user.role === "CLIENT") {
    const client =
      await getClientByUserId(user.id);

    if (!client) return null;

    return {
      parentId: null,
      clientId: client.id,
    };
  }

  return null;
};

export const topUp = async (
  req,
  res
) => {
  try {
    const amount = Number(
      req.body.amount
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    const owner =
      await resolveOwner(req.user);

    if (!owner) {
      return res.status(403).json({
        success: false,
        message:
          "Wallet unavailable for role",
      });
    }

    const wallet =
      await creditWallet({
        ...owner,
        amount,
        reference: `topup-${Date.now()}`,
      });

    return res.json({
      success: true,
      balance: wallet.balance,
    });
  } catch (err) {
    console.error(
      "[wallet.topUp]",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "Wallet top up failed",
    });
  }
};

export const balance = async (
  req,
  res
) => {
  try {
    const owner =
      await resolveOwner(req.user);

    if (!owner) {
      return res.status(403).json({
        success: false,
        message:
          "Wallet unavailable",
      });
    }

    const wallet =
      await getWallet(owner);

    return res.json({
      success: true,
      balance: wallet.balance,
    });
  } catch (err) {
    console.error(
      "[wallet.balance]",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch wallet",
    });
  }
};