// src/controllers/mpesa.controller.js
import prisma from "../middleware/prisma.js";

// ✅ FIXED: wallet.service.js is at src/services/ — NOT src/services/billing/
import {
  getParentByUserId,
  getClientByUserId,
} from "../services/wallet.service.js";

// mpesa.service.js IS in billing/
import {
  initiateSTKPush,
  initiateB2C,
  normalizePhone,
  registerC2BUrls,
  simulateC2B,
} from "../services/billing/mpesa.service.js";

/* ============================================================
   IN-MEMORY PENDING STK MAP
   CheckoutRequestID → { transactionId, walletId, parentId, clientId, amount }
   Survives a single instance — replace with Redis for multi-instance.
============================================================ */
const pendingSTK = new Map();

/* ============================================================
   HELPER — resolve wallet owner (parentId or clientId) from JWT
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

/** Get or create wallet for a parent/client */
const ensureWallet = async (tx, { parentId, clientId }) => {
  const where = parentId ? { parentId } : { clientId };
  let wallet  = await tx.wallet.findFirst({ where });
  if (!wallet) {
    wallet = await tx.wallet.create({
      data: { parentId: parentId ?? null, clientId: clientId ?? null, balance: 0 },
    });
  }
  return wallet;
};

/* ============================================================
   POST /api/mpesa/stk-push
   Lipa na M-Pesa Online — sends STK prompt to user's phone.
   Auth required. Roles: PARENT, CLIENT
   Body: { phone: string, amount: number }
============================================================ */
export const stkPush = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone?.trim();
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

    // Ensure wallet exists
    const wallet = await prisma.$transaction(async (tx) => ensureWallet(tx, owner));

    // Create PENDING transaction BEFORE calling Daraja
    // (ensures a record exists even if the app crashes mid-request)
    const pendingTx = await prisma.transaction.create({
      data: {
        walletId:  wallet.id,
        parentId:  owner.parentId ?? null,
        clientId:  owner.clientId ?? null,
        amount,
        type:      "DEPOSIT",
        status:    "PENDING",
        reference: null,
      },
    });

    // Call Daraja STK Push
    let darajaRes;
    try {
      darajaRes = await initiateSTKPush({
        phone,
        amount,
        accountRef:  `TRK${user.id}`,
        description: "Wallet TopUp",
      });
    } catch (darajaErr) {
      await prisma.transaction.update({
        where: { id: pendingTx.id },
        data:  { status: "FAILED" },
      });
      console.error("[stkPush] Daraja error:", darajaErr?.response?.data ?? darajaErr.message);
      return res.status(502).json({
        success: false,
        message: "Could not reach M-Pesa. Please try again.",
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

    // Persist CheckoutRequestID on the transaction
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
      message:           "STK Push sent — enter your M-Pesa PIN.",
      checkoutRequestId,
      merchantRequestId: darajaRes.MerchantRequestID,
    });
  } catch (err) {
    console.error("[stkPush] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   POST /api/mpesa/stk-callback
   ⚠️  PUBLIC — Safaricom calls this after user enters PIN.
   Always respond 200 immediately (Safaricom retries on timeout).
============================================================ */
export const stkCallback = async (req, res) => {
  // Respond immediately so Safaricom doesn't retry
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode        = Number(callback.ResultCode);

    const pending = pendingSTK.get(checkoutRequestId);
    if (!pending) {
      // Might have been handled already or server restarted — look up by reference
      const tx = await prisma.transaction.findFirst({
        where: { reference: checkoutRequestId, status: "PENDING" },
      });
      if (!tx) {
        console.warn("[stkCallback] Unknown CheckoutRequestID:", checkoutRequestId);
        return;
      }
      // Reconstruct pending from DB
      const wallet = await prisma.wallet.findUnique({ where: { id: tx.walletId } });
      if (wallet) {
        pendingSTK.set(checkoutRequestId, {
          transactionId: tx.id,
          walletId:      tx.walletId,
          parentId:      tx.parentId,
          clientId:      tx.clientId,
          amount:        tx.amount,
        });
      }
    }

    const p = pendingSTK.get(checkoutRequestId);
    pendingSTK.delete(checkoutRequestId);

    if (!p) return;

    if (resultCode !== 0) {
      await prisma.transaction.update({
        where: { id: p.transactionId },
        data:  { status: "FAILED" },
      });
      console.log(`[stkCallback] ❌ Payment failed (${resultCode}): ${callback.ResultDesc}`);
      return;
    }

    // Extract Safaricom metadata
    const items   = callback.CallbackMetadata?.Item ?? [];
    const getMeta = (name) => items.find((i) => i.Name === name)?.Value ?? null;

    const paidAmount = Number(getMeta("Amount")) || p.amount;
    const receipt    = getMeta("MpesaReceiptNumber");
    const paidPhone  = getMeta("PhoneNumber");

    // Credit wallet + mark SUCCESS — atomically
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: p.walletId },
        data:  { balance: { increment: paidAmount } },
      }),
      prisma.transaction.update({
        where: { id: p.transactionId },
        data:  {
          amount:    paidAmount,
          status:    "SUCCESS",
          reference: receipt ?? checkoutRequestId,
        },
      }),
    ]);

    console.log(`[stkCallback] ✅ KES ${paidAmount} credited — wallet: ${p.walletId}, receipt: ${receipt}, phone: ${paidPhone}`);
  } catch (err) {
    console.error("[stkCallback] Error processing callback:", err);
  }
};

/* ============================================================
   GET /api/mpesa/stk-status/:checkoutRequestId
   Frontend polls this every 3s after STK push.
   Auth required.
============================================================ */
export const stkStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    if (!checkoutRequestId) {
      return res.status(400).json({ success: false, message: "checkoutRequestId required." });
    }

    const transaction = await prisma.transaction.findFirst({
      where:  { reference: checkoutRequestId },
      select: { status: true, amount: true, createdAt: true },
    });

    if (!transaction) {
      // STK was just sent — might not be saved yet
      return res.status(200).json({ success: true, status: "PENDING" });
    }

    return res.status(200).json({
      success: true,
      status:  transaction.status,   // PENDING | SUCCESS | FAILED
      amount:  transaction.amount,
    });
  } catch (err) {
    console.error("[stkStatus]", err);
    return res.status(500).json({ success: false, message: "Failed to check payment status." });
  }
};

/* ============================================================
   C2B — REGISTER URLS
   POST /api/mpesa/c2b/register
   One-time call per shortcode. Run manually or on server startup.
   Auth required. Role: ADMIN or SYSTEM_ADMIN
============================================================ */
export const c2bRegister = async (req, res) => {
  try {
    const role = req.user?.role?.toUpperCase();
    if (role !== "ADMIN" && role !== "SYSTEM_ADMIN") {
      return res.status(403).json({ success: false, message: "ADMIN only." });
    }

    const responseType = req.body?.responseType || "Completed";
    const result = await registerC2BUrls(responseType);

    return res.status(200).json({
      success: true,
      message: "C2B URLs registered with Safaricom.",
      data:    result,
    });
  } catch (err) {
    console.error("[c2bRegister]", err?.response?.data ?? err.message);
    return res.status(502).json({
      success: false,
      message: "Failed to register C2B URLs.",
      detail:  err?.response?.data,
    });
  }
};

/* ============================================================
   C2B — VALIDATION URL
   POST /api/mpesa/c2b/validate
   ⚠️  PUBLIC — Safaricom calls this BEFORE processing a payment.
   Return { ResultCode: 0 } to accept, { ResultCode: C2B00011 } to reject.

   Use this to check if the BillRefNumber (accountRef) maps to a real user.
============================================================ */
export const c2bValidate = async (req, res) => {
  try {
    const { BillRefNumber, TransactionAmount, MSISDN } = req.body;

    console.log(`[c2bValidate] Incoming — phone: ${MSISDN}, ref: ${BillRefNumber}, amount: ${TransactionAmount}`);

    // BillRefNumber = "TRK-{userId}" that we set on the STK push / mobile app
    const userId = extractUserIdFromRef(BillRefNumber);

    if (!userId) {
      console.warn(`[c2bValidate] Rejected — unknown BillRefNumber: ${BillRefNumber}`);
      return res.status(200).json({
        ResultCode:    "C2B00011",
        ResultDesc:    "Rejected: unknown account reference",
      });
    }

    // Accept
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[c2bValidate] Error:", err);
    // Accept on error — do not block payments over a server bug
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
};

/* ============================================================
   C2B — CONFIRMATION URL
   POST /api/mpesa/c2b/confirm
   ⚠️  PUBLIC — Safaricom calls this AFTER payment is processed.
   Credit the correct wallet based on BillRefNumber.
============================================================ */
export const c2bConfirm = async (req, res) => {
  // Respond immediately
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const {
      TransactionType,
      TransID,          // M-Pesa receipt number
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber,    // accountRef we set: "TRK{userId}" or custom
      MSISDN,           // customer phone
      FirstName,
    } = req.body;

    const amount = Number(TransAmount);
    console.log(`[c2bConfirm] ✅ Payment received — receipt: ${TransID}, amount: KES ${amount}, phone: ${MSISDN}, ref: ${BillRefNumber}`);

    // Resolve who paid
    const userId = extractUserIdFromRef(BillRefNumber);
    if (!userId) {
      console.warn(`[c2bConfirm] Cannot resolve userId from ref: ${BillRefNumber}`);
      return;
    }

    // Try parent first, then client
    let owner = null;
    const parent = await getParentByUserId(userId);
    if (parent) {
      owner = { parentId: parent.id, clientId: null };
    } else {
      const client = await getClientByUserId(userId);
      if (client) owner = { parentId: null, clientId: client.id };
    }

    if (!owner) {
      console.warn(`[c2bConfirm] No parent/client profile for userId: ${userId}`);
      return;
    }

    // Get or create wallet
    const wallet = await prisma.$transaction(async (tx) => ensureWallet(tx, owner));

    // Check for duplicate (idempotency) — TransID is unique per payment
    const existing = await prisma.transaction.findFirst({
      where: { reference: TransID },
    });
    if (existing) {
      console.warn(`[c2bConfirm] Duplicate — TransID ${TransID} already recorded`);
      return;
    }

    // Credit wallet + create transaction record
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data:  { balance: { increment: amount } },
      }),
      prisma.transaction.create({
        data: {
          walletId:  wallet.id,
          parentId:  owner.parentId ?? null,
          clientId:  owner.clientId ?? null,
          amount,
          type:      "DEPOSIT",
          status:    "SUCCESS",
          reference: TransID,
        },
      }),
    ]);

    console.log(`[c2bConfirm] ✅ Wallet ${wallet.id} credited KES ${amount} — receipt: ${TransID}`);
  } catch (err) {
    console.error("[c2bConfirm] Error processing confirmation:", err);
  }
};

/* ============================================================
   C2B — SIMULATE (sandbox only)
   POST /api/mpesa/c2b/simulate
   Auth required. Role: ADMIN or SYSTEM_ADMIN
   Body: { phone, amount, billRef }
============================================================ */
export const c2bSimulate = async (req, res) => {
  try {
    if (process.env.MPESA_ENV === "production") {
      return res.status(403).json({
        success: false,
        message: "Simulation is not available in production.",
      });
    }

    const role = req.user?.role?.toUpperCase();
    if (role !== "ADMIN" && role !== "SYSTEM_ADMIN") {
      return res.status(403).json({ success: false, message: "ADMIN only." });
    }

    const { phone, amount, billRef } = req.body;
    if (!phone || !amount) {
      return res.status(400).json({ success: false, message: "phone and amount are required." });
    }

    const result = await simulateC2B({
      phone,
      amount: Number(amount),
      billRef: billRef || "TEST",
    });

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("[c2bSimulate]", err?.response?.data ?? err.message);
    return res.status(502).json({
      success: false,
      message: "C2B simulation failed.",
      detail:  err?.response?.data,
    });
  }
};

/* ============================================================
   B2C WITHDRAW
   POST /api/mpesa/b2c
   Auth required. Role: AGENT
   Body: { phone: string, amount: number }
============================================================ */
export const b2cWithdraw = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone?.trim();
    const amount = Number(req.body?.amount);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid withdrawal amount." });
    }
    if (user?.role?.toUpperCase() !== "AGENT") {
      return res.status(403).json({ success: false, message: "Only AGENT accounts can withdraw." });
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

    // Optimistic deduction — reverse on Daraja failure
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

    // Call Daraja
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
      console.error("[b2cWithdraw] Daraja error:", darajaErr?.response?.data ?? darajaErr.message);
      return res.status(502).json({
        success: false,
        message: "M-Pesa withdrawal failed. Your balance was not affected.",
      });
    }

    // Save ConversationID for result callback matching
    await prisma.agentTransaction.update({
      where: { id: agentTx.id },
      data:  { reference: darajaRes.ConversationID ?? darajaRes.OriginatorConversationID },
    });

    return res.status(200).json({
      success:        true,
      message:        "Withdrawal initiated. Funds will arrive within minutes.",
      newBalance:     updatedWallet.balance,
      conversationId: darajaRes.ConversationID,
    });
  } catch (err) {
    console.error("[b2cWithdraw] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   B2C — RESULT CALLBACK
   POST /api/mpesa/b2c/callback
   ⚠️  PUBLIC — Safaricom posts B2C result here.
============================================================ */
export const b2cCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const result = req.body?.Result;
    if (!result) return;

    const conversationId = result.ConversationID;
    const resultCode     = Number(result.ResultCode);

    const agentTx = await prisma.agentTransaction.findFirst({
      where: { reference: conversationId },
    });

    if (!agentTx) {
      console.warn("[b2cCallback] No matching agent transaction:", conversationId);
      return;
    }

    if (resultCode !== 0) {
      // Reverse deduction — money didn't leave
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
      console.log(`[b2cCallback] ❌ B2C failed (${resultCode}) — KES ${agentTx.amount} reversed`);
      return;
    }

    const params   = result.ResultParameters?.ResultParameter ?? [];
    const getParam = (key) => params.find((p) => p.Key === key)?.Value ?? null;
    const receipt  = getParam("TransactionReceipt");

    await prisma.agentTransaction.update({
      where: { id: agentTx.id },
      data:  {
        reference:   receipt ?? conversationId,
        description: `Withdrawal SUCCESS — ${receipt}`,
      },
    });

    console.log(`[b2cCallback] ✅ B2C success — receipt: ${receipt}`);
  } catch (err) {
    console.error("[b2cCallback] Error:", err);
  }
};

/* ============================================================
   B2C — TIMEOUT CALLBACK
   POST /api/mpesa/b2c/timeout
   ⚠️  PUBLIC
============================================================ */
export const b2cTimeout = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  console.warn("[b2cTimeout] B2C request timed out:", JSON.stringify(req.body));
};

/* ============================================================
   PRIVATE HELPERS
============================================================ */

/**
 * Extract userId from BillRefNumber.
 * Format we set: "TRK{userId}" e.g. "TRK42"
 * Also handles legacy format "TRK-42"
 */
function extractUserIdFromRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/TRK-?(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}