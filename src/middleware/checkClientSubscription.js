// src/middleware/checkClientSubscription.js
const { getActiveSubscription, activateSubscription, DAILY_FEE } = require('../services/subscription.service');
const { deductWallet } = require('../services/wallet.service');

/**
 * Middleware factory: checks/renews a Client's subscription for a given asset.
 * Usage: router.get('/:assetId', checkClientSubscription('assetId'), controller)
 *
 * @param {string} paramName - the req.params key holding the assetId
 */
const checkClientSubscription = (paramName = 'assetId') => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const assetId = req.params[paramName];

      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized. Please log in.',
        });
      }

      if (!assetId) {
        return res.status(400).json({
          success: false,
          message: 'Asset ID is required.',
        });
      }

      // 1. Check for active subscription
      const active = await getActiveSubscription({
        userId: user.id,
        assetId,
      });

      if (active) {
        req.subscription = active;
        return next();
      }

      // 2. Auto-bill
      let updatedWallet;
      try {
        updatedWallet = await deductWallet(
          user.id,
          DAILY_FEE,
          `Daily tracking subscription for asset ${assetId}`
        );
      } catch (walletErr) {
        if (
          walletErr.code === 'INSUFFICIENT_BALANCE' ||
          walletErr.code === 'WALLET_NOT_FOUND'
        ) {
          return res.status(402).json({
            success: false,
            message: walletErr.message,
            code: walletErr.code,
            currentBalance: walletErr.currentBalance ?? 0,
            requiredAmount: DAILY_FEE,
            action: 'TOP_UP_REQUIRED',
          });
        }
        console.error('[checkClientSubscription] Wallet error:', walletErr);
        return res.status(500).json({
          success: false,
          message: 'A billing error occurred. Please try again.',
        });
      }

      // 3. Activate subscription
      const subscription = await activateSubscription({
        userId: user.id,
        assetId,
      });

      req.subscription = subscription;
      req.walletBalance = updatedWallet.balance;

      return next();
    } catch (err) {
      console.error('[checkClientSubscription] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  };
};

module.exports = checkClientSubscription;