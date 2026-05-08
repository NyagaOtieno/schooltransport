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
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "Student ID required",
        });
      }

      const active = await getActiveSubscription({
        userId: user.id,
        studentId,
      });

      if (active) {
        req.subscription = active;
        return next();
      }

      let updatedWallet;

      try {
        updatedWallet = await deductWallet(
          user.id,
          DAILY_FEE,
          `Daily tracking subscription for student ${studentId}`
        );
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

        console.error(walletErr);
        return res.status(500).json({
          success: false,
          message: "Billing error occurred",
        });
      }

      const subscription = await activateSubscription({
        userId: user.id,
        studentId,
      });

      req.subscription = subscription;
      req.walletBalance = updatedWallet.balance;

      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unexpected error",
      });
    }
  };
};

export default checkParentSubscription;