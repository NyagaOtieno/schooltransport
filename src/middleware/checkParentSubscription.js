import {
  getActiveSubscription,
  activateSubscription,
  DAILY_FEE,
} from "../services/subscription.service.js";

import { deductWallet } from "../services/wallet.service.js";

const checkParentSubscription = (paramName = "studentId") => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const studentId = req.params[paramName];

      if (!user?.id) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      if (!studentId) {
        return res.status(400).json({ success: false, message: "Student ID required" });
      }

      const active = await getActiveSubscription({
        parentId: user.parentId ?? null,
        clientId: user.clientId ?? null,
        studentId,
      });

      if (active) {
        req.subscription = active;
        return next();
      }

      let updatedWallet;

      try {
        updatedWallet = await deductWallet({
          parentId: user.parentId ?? null,
          clientId: user.clientId ?? null,
          amount: DAILY_FEE,
          reference: `student-${studentId}-${Date.now()}`,
        });
      } catch (walletErr) {
        if (
          walletErr.code === "INSUFFICIENT_BALANCE" ||
          walletErr.code === "WALLET_NOT_FOUND"
        ) {
          return res.status(402).json({
            success: false,
            message: walletErr.message,
            code: walletErr.code,
            currentBalance: walletErr.currentBalance ?? 0,
            requiredAmount: DAILY_FEE,
            action: "TOP_UP_REQUIRED",
          });
        }

        return res.status(500).json({
          success: false,
          message: "Billing error occurred",
        });
      }

      const subscription = await activateSubscription({
        parentId: user.parentId ?? null,
        clientId: user.clientId ?? null,
        studentId,
      });

      req.subscription = subscription;
      req.walletBalance = updatedWallet.balance;

      next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Unexpected error",
      });
    }
  };
};

export default checkParentSubscription;