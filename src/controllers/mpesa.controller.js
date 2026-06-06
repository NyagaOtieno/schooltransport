// src/controllers/mpesa.controller.js
import prisma from "../middleware/prisma.js";

// ✅ Correct path — your mpesa service lives in services/billing/
import {
  initiateSTKPush,
  initiateB2C,
  normalizePhone,
} from "../services/billing/mpesa.service.js";

// ✅ Correct path — wallet service lives in services/billing/
import {
  getParentByUserId,
  getClientByUserId,
} from "../services/billing/wallet.service.js";

/* ============================================================
   IN-MEMORY PENDING STK MAP
   Maps CheckoutRequestID → { transactionId, walletId, parentId, clientId, amount }
   Replace with Redis for multi-instance deployments.
============================================================ */
const pendingSTK = new Map();

/* ============================================================
   HELPER — resolve parentId/clientId from JWT user
============================================================ */
const resolveOwner = async (user) => {
  const role = user?.role?.toUpperCase();
  if (role === "PARENT") {
    const parent = await getParentByUserId(user.id);
    return parent ? { parentId: parent.id, clientId: null } : null;
  }
  if (role === "CLIENT") {
    const client = await getClientByUserId(user.id);
    return client ? { parentId: null, clientId: client.id } : null;
  }
  return null;
};

/* ============================================================
   POST /api/mpesa/stk-push
   Body: { phone: string, amount: number }
   Roles: PARENT, CLIENT
============================================================ */
export const stkPush = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone;
    const amount = Number(req.body?.amount);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }
    if (!Number.isFinite(amount) || amount < 10) {
      return res.status(400).json({ success: false, message: "Minimum deposit is KES 10." });
    }

    const owner = await resolveOwner(user);
    if (!owner) {
      return res.status(403).json({
        success: false,
        message: "Only PARENT or CLIENT accounts can top up a wallet.",
      });
    }

    // Get or create wallet
    const whereClause = owner.parentId ? { parentId: owner.parentId } : { clientId: owner.clientId };
    let wallet = await prisma.wallet.findFirst({ where: whereClause });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          parentId: owner.parentId ?? null,
          clientId: owner.clientId ?? null,
          balance:  0,
        },
      });
    }

    // Create PENDING transaction before calling Daraja
    const pendingTx = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        parentId: owner.parentId ?? null,
        clientId: owner.clientId ?? null,
        amount,
        type:     "DEPOSIT",
        status:   "PENDING",
        reference: null,
      },
    });

    // Call Daraja
    let darajaRes;
    try {
      darajaRes = await initiateSTKPush({
        phone,
        amount,
        accountRef:  `TRK-${user.id}`,
        description: "TrackMyKid Wallet Top Up",
      });
    } catch (darajaErr) {
      await prisma.transaction.update({
        where: { id: pendingTx.id },
        data:  { status: "FAILED" },
      });
      console.error("[mpesa.stkPush] Daraja error:", darajaErr?.response?.data || darajaErr.message);
      return res.status(502).json({
        success: false,
        message: "Failed to reach M-Pesa. Please try again.",
      });
    }

    if (darajaRes.ResponseCode !== "0") {
      await prisma.transaction.update({
        where: { id: pendingTx.id },
        data:  { status: "FAILED" },
      });
      return res.status(400).json({
        success: false,
        message: darajaRes.ResponseDescription || "STK Push failed.",
      });
    }

    const checkoutRequestId = darajaRes.CheckoutRequestID;

    // Update transaction with CheckoutRequestID
    await prisma.transaction.update({
      where: { id: pendingTx.id },
      data:  { reference: checkoutRequestId },
    });

    // Cache for callback lookup
    pendingSTK.set(checkoutRequestId, {
      transactionId: pendingTx.id,
      walletId:      wallet.id,
      parentId:      owner.parentId ?? null,
      clientId:      owner.clientId ?? null,
      amount,
    });

    return res.status(200).json({
      success:           true,
      message:           "STK Push sent. Enter your M-Pesa PIN to complete payment.",
      checkoutRequestId,
    });
  } catch (err) {
    console.error("[mpesa.stkPush] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   POST /api/mpesa/callback
   Called by Safaricom — NO auth header.
   Always respond 200 immediately.
============================================================ */
export const stkCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode        = callback.ResultCode;

    const pending = pendingSTK.get(checkoutRequestId);
    if (!pending) {
      console.warn("[mpesa.callback] Unknown CheckoutRequestID:", checkoutRequestId);
      return;
    }

    pendingSTK.delete(checkoutRequestId);

    if (resultCode !== 0) {
      await prisma.transaction.update({
        where: { id: pending.transactionId },
        data:  { status: "FAILED" },
      });
      console.log(`[mpesa.callback] Payment failed — code ${resultCode}: ${callback.ResultDesc}`);
      return;
    }

    // Extract metadata
    const items    = callback.CallbackMetadata?.Item || [];
    const getMeta  = (name) => items.find((i) => i.Name === name)?.Value ?? null;
    const paidAmt  = Number(getMeta("Amount")) || pending.amount;
    const receipt  = getMeta("MpesaReceiptNumber");

    // Atomically credit wallet + mark transaction SUCCESS
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: pending.walletId },
        data:  { balance: { increment: paidAmt } },
      }),
      prisma.transaction.update({
        where: { id: pending.transactionId },
        data:  {
          amount:    paidAmt,
          status:    "SUCCESS",
          reference: receipt ?? checkoutRequestId,
        },
      }),
    ]);

    console.log(`[mpesa.callback] ✅ KES ${paidAmt} credited to wallet ${pending.walletId} — receipt: ${receipt}`);
  } catch (err) {
    console.error("[mpesa.callback] Error:", err);
  }
};

/* ============================================================
   GET /api/mpesa/stk-status/:checkoutRequestId
   Frontend polls this after STK push.
   Roles: PARENT, CLIENT
============================================================ */
export const stkStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    if (!checkoutRequestId) {
      return res.status(400).json({ success: false, message: "checkoutRequestId is required." });
    }

    const transaction = await prisma.transaction.findFirst({
      where:  { reference: checkoutRequestId },
      select: { status: true, amount: true },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    return res.status(200).json({
      success: true,
      status:  transaction.status,   // PENDING | SUCCESS | FAILED
      amount:  transaction.amount,
    });
  } catch (err) {
    console.error("[mpesa.stkStatus]", err);
    return res.status(500).json({ success: false, message: "Failed to check payment status." });
  }
};

/* ============================================================
   POST /api/mpesa/b2c
   Agent withdrawal to M-Pesa.
   Role: AGENT
   Body: { phone: string, amount: number }
============================================================ */
export const b2cWithdraw = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone;
    const amount = Number(req.body?.amount);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid withdrawal amount." });
    }
    if (user?.role?.toUpperCase() !== "AGENT") {
      return res.status(403).json({ success: false, message: "Only agents can withdraw." });
    }

    const agent = await prisma.agent.findFirst({
      where:   { userId: user.id },
      include: { wallet: true },
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    const agentWallet = agent.wallet;

    if (!agentWallet || agentWallet.balance < amount) {
      return res.status(402).json({
        success:         false,
        message:         "Insufficient agent wallet balance.",
        currentBalance:  agentWallet?.balance ?? 0,
        requestedAmount: amount,
      });
    }

    // Deduct first (optimistic), then call Daraja
    const [updatedWallet, agentTx] = await prisma.$transaction([
      prisma.agentWallet.update({
        where: { id: agentWallet.id },
        data:  { balance: { decrement: amount } },
      }),
      prisma.agentTransaction.create({
        data: {
          walletId:      agentWallet.id,
          type:          "WITHDRAWAL",
          amount,
          description:   `M-Pesa withdrawal to ${normalizePhone(phone)}`,
          reference:     null,
          balanceBefore: agentWallet.balance,
          balanceAfter:  agentWallet.balance - amount,
        },
      }),
    ]);

    // Call Daraja B2C
    let darajaRes;
    try {
      darajaRes = await initiateB2C({
        phone,
        amount,
        remarks:  "TrackMyKid Agent Withdrawal",
        occasion: "AgentWithdrawal",
      });
    } catch (darajaErr) {
      // Reverse deduction
      await prisma.$transaction([
        prisma.agentWallet.update({
          where: { id: agentWallet.id },
          data:  { balance: { increment: amount } },
        }),
        prisma.agentTransaction.update({
          where: { id: agentTx.id },
          data:  { description: "Withdrawal reversed — Daraja unreachable" },
        }),
      ]);
      console.error("[mpesa.b2c] Daraja error:", darajaErr?.response?.data || darajaErr.message);
      return res.status(502).json({
        success: false,
        message: "M-Pesa withdrawal failed. Your balance was not affected.",
      });
    }

    // Save ConversationID for callback matching
    await prisma.agentTransaction.update({
      where: { id: agentTx.id },
      data:  { reference: darajaRes.ConversationID ?? darajaRes.OriginatorConversationID },
    });

    return res.status(200).json({
      success:        true,
      message:        "Withdrawal initiated. Funds will arrive shortly.",
      newBalance:     updatedWallet.balance,
      conversationId: darajaRes.ConversationID,
    });
  } catch (err) {
    console.error("[mpesa.b2cWithdraw] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   POST /api/mpesa/b2c-callback
   Safaricom B2C result — NO auth.
============================================================ */
export const b2cCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const result         = req.body?.Result;
    if (!result) return;

    const conversationId = result.ConversationID;
    const resultCode     = result.ResultCode;

    const agentTx = await prisma.agentTransaction.findFirst({
      where: { reference: conversationId },
    });

    if (!agentTx) {
      console.warn("[mpesa.b2cCallback] No matching agent transaction:", conversationId);
      return;
    }

    if (resultCode !== 0) {
      // Reverse the deduction
      await prisma.$transaction([
        prisma.agentWallet.update({
          where: { id: agentTx.walletId },
          data:  { balance: { increment: agentTx.amount } },
        }),
        prisma.agentTransaction.update({
          where: { id: agentTx.id },
          data:  { description: `Withdrawal FAILED (code ${resultCode}) — reversed` },
        }),
      ]);
      console.log(`[mpesa.b2cCallback] ❌ B2C failed, KES ${agentTx.amount} reversed`);
      return;
    }

    const params   = result.ResultParameters?.ResultParameter || [];
    const getParam = (key) => params.find((p) => p.Key === key)?.Value ?? null;
    const receipt  = getParam("TransactionReceipt");

    await prisma.agentTransaction.update({
      where: { id: agentTx.id },
      data:  { description: `Withdrawal SUCCESS — ${receipt}`, reference: receipt ?? conversationId },
    });

    console.log(`[mpesa.b2cCallback] ✅ B2C success — receipt: ${receipt}`);
  } catch (err) {
    console.error("[mpesa.b2cCallback] Error:", err);
  }
};

/* ============================================================
   POST /api/mpesa/b2c-timeout
============================================================ */
export const b2cTimeout = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  console.warn("[mpesa.b2cTimeout] B2C timed out:", req.body);
};