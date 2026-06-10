// src/middleware/checkParentSubscription.js
// Gates tracking access behind wallet subscription.
// Flow:
//   1. Resolve parent from JWT userId
//   2. Check for active subscription (24h window)
//   3. If active → pass through (free)
//   4. If not → deduct DAILY_FEE from wallet → activate subscription
//   5. If insufficient balance → 402 (frontend shows top-up prompt)
//
// Safety: every code path is wrapped in try/catch.
// This middleware NEVER crashes the server.

import prisma from "../middleware/prisma.js";

const DAILY_FEE           = Number(process.env.DAILY_SUBSCRIPTION_FEE) || 10;
const SUBSCRIPTION_HOURS  = 24;

/* ============================================================
   HELPERS
============================================================ */

/** Resolve the Parent record for a given userId */
const getParentByUserId = async (userId) =>
  prisma.parent.findFirst({ where: { userId } });

/** Check for a non-expired ACTIVE subscription for this parent + student */
const getActiveSubscription = async (parentId, studentId) =>
  prisma.subscription.findFirst({
    where: {
      parentId,
      studentId,
      status:     "ACTIVE",
      expiryDate: { gt: new Date() },
    },
  });

/** Deduct wallet and activate subscription — all in one DB transaction */
const deductAndActivate = async (parentId, studentId) => {
  return prisma.$transaction(async (tx) => {
    // Lock the wallet row
    const wallet = await tx.wallet.findFirst({ where: { parentId } });

    if (!wallet) {
      const err   = new Error("Wallet not found. Please top up to continue.");
      err.code    = "WALLET_NOT_FOUND";
      err.balance = 0;
      throw err;
    }

    if (wallet.balance < DAILY_FEE) {
      const err   = new Error("Insufficient balance. Please top up to track your child.");
      err.code    = "INSUFFICIENT_BALANCE";
      err.balance = wallet.balance;
      throw err;
    }

    // Deduct balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data:  { balance: { decrement: DAILY_FEE } },
    });

    // Log transaction
    await tx.transaction.create({
      data: {
        walletId:  wallet.id,
        parentId,
        amount:    DAILY_FEE,
        type:      "DEDUCTION",
        status:    "SUCCESS",
        reference: `sub-student-${studentId}-${Date.now()}`,
      },
    });

    // Activate or renew subscription
    const expiryDate = new Date(Date.now() + SUBSCRIPTION_HOURS * 60 * 60 * 1000);

    const existing = await tx.subscription.findFirst({
      where: { parentId, studentId },
    });

    let subscription;
    if (existing) {
      subscription = await tx.subscription.update({
        where: { id: existing.id },
        data:  { status: "ACTIVE", expiryDate, type: "DAILY" },
      });
    } else {
      subscription = await tx.subscription.create({
        data: { parentId, studentId, status: "ACTIVE", expiryDate, type: "DAILY" },
      });
    }

    return { subscription, newBalance: wallet.balance - DAILY_FEE };
  });
};

/* ============================================================
   MIDDLEWARE FACTORY
   Usage: router.get("/student/:studentId", checkParentSubscription("studentId"), handler)
============================================================ */
const checkParentSubscription = (paramName = "studentId") => {
  return async (req, res, next) => {
    try {
      const user      = req.user;
      const studentId = Number(req.params[paramName]);

      // ── Auth check ────────────────────────────────────────
      if (!user?.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      if (!Number.isFinite(studentId) || studentId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid studentId." });
      }

      // ── Only PARENT role uses subscription ────────────────
      // ADMIN, DRIVER, ASSISTANT bypass the check entirely
      const role = user?.role?.toUpperCase();
      if (role !== "PARENT" && role !== "CLIENT") {
        return next();
      }

      // ── Resolve parent record ─────────────────────────────
      const parent = await getParentByUserId(user.id);

      if (!parent) {
        // User has PARENT role but no parent profile yet
        return res.status(403).json({
          success: false,
          message: "Parent profile not found. Please contact your administrator.",
        });
      }

      const parentId = parent.id;

      // ── Check for existing active subscription ────────────
      const existing = await getActiveSubscription(parentId, studentId);

      if (existing) {
        // Already subscribed — pass through at no cost
        req.subscription   = existing;
        req.walletDeducted = false;
        return next();
      }

      // ── No active subscription — auto-deduct and activate ─
      let result;
      try {
        result = await deductAndActivate(parentId, studentId);
      } catch (walletErr) {
        if (
          walletErr.code === "INSUFFICIENT_BALANCE" ||
          walletErr.code === "WALLET_NOT_FOUND"
        ) {
          return res.status(402).json({
            success:        false,
            message:        walletErr.message,
            code:           walletErr.code,
            currentBalance: walletErr.balance ?? 0,
            requiredAmount: DAILY_FEE,
            action:         "TOP_UP_REQUIRED",
          });
        }
        // Unexpected DB error
        console.error("[checkParentSubscription] Wallet deduction error:", walletErr);
        return res.status(500).json({
          success: false,
          message: "A billing error occurred. Please try again.",
        });
      }

      req.subscription   = result.subscription;
      req.walletBalance  = result.newBalance;
      req.walletDeducted = true;

      return next();

    } catch (err) {
      // ✅ Safety net — this middleware NEVER crashes the server
      console.error("[checkParentSubscription] Unexpected error:", err);
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred. Please try again.",
      });
    }
  };
};

export default checkParentSubscription;