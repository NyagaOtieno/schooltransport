// src/controllers/mpesa.controller.js
import prisma from "../middleware/prisma.js";
import {
  getParentByUserId, getClientByUserId, getAgentByUserId,
  creditAgentWallet,
} from "../services/wallet.service.js";
import {
  initiateSTKPush, initiateB2C, normalizePhone,
  registerC2BUrls, simulateC2B,
} from "../services/billing/mpesa.service.js";

/* ============================================================
   IN-MEMORY PENDING STK PUSH MAP
   CheckoutRequestID → pending payment context
   Replace with Redis for multi-instance deployments.
============================================================ */
const pendingSTK = new Map();

/* ============================================================
   HELPERS
============================================================ */

/**
 * Resolve the paying entity from a JWT user.
 * Returns a typed owner object for both wallet types.
 */
const resolveOwner = async (user) => {
  const role = user?.role?.toUpperCase();

  if (role === "PARENT") {
    const parent = await getParentByUserId(user.id);
    return parent
      ? { type: "wallet", parentId: parent.id, clientId: null }
      : null;
  }
  if (role === "CLIENT") {
    const client = await getClientByUserId(user.id);
    return client
      ? { type: "wallet", parentId: null, clientId: client.id }
      : null;
  }
  if (role === "AGENT") {
    const agent = await getAgentByUserId(user.id);    // includes { wallet }
    return agent
      ? { type: "agentWallet", agentId: agent.id, existingWallet: agent.wallet }
      : null;
  }
  return null;
};

/** Get or create a Wallet for parent/client */
const ensureWallet = async (tx, { parentId, clientId }) => {
  const where = parentId ? { parentId } : { clientId };
  let w = await tx.wallet.findFirst({ where });
  if (!w) w = await tx.wallet.create({ data: { parentId: parentId ?? null, clientId: clientId ?? null, balance: 0 } });
  return w;
};

/** Get or create an AgentWallet */
const ensureAgentWallet = async (tx, agentId) => {
  let w = await tx.agentWallet.findUnique({ where: { agentId } });
  if (!w) w = await tx.agentWallet.create({ data: { agentId, balance: 0 } });
  return w;
};

/* ============================================================
   POST /api/mpesa/stk-push
   Works for PARENT, CLIENT and AGENT.
   Body: { phone: string, amount: number }
============================================================ */
export const stkPush = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone?.trim();
    const amount = Number(req.body?.amount);

    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });
    if (!Number.isFinite(amount) || amount < 10)
      return res.status(400).json({ success: false, message: "Minimum deposit is KES 10." });

    const owner = await resolveOwner(user);
    if (!owner) {
      return res.status(403).json({ success: false, message: "PARENT, CLIENT or AGENT accounts only." });
    }

    // ── Create PENDING transaction record ────────────────
    let pendingRecord;

    if (owner.type === "agentWallet") {
      // Agent: ensure AgentWallet exists, then create AgentTransaction
      const agentWallet = await prisma.$transaction(async (tx) => ensureAgentWallet(tx, owner.agentId));

      pendingRecord = await prisma.agentTransaction.create({
        data: {
          walletId:      agentWallet.id,
          type:          "TOPUP",
          amount,
          description:   "M-Pesa top-up (pending)",
          reference:     null,       // filled after Daraja responds
          balanceBefore: agentWallet.balance,
          balanceAfter:  agentWallet.balance + amount,  // optimistic — updated on callback
        },
      });

      // Store context for callback
      pendingSTK.set("_agent_tx_" + pendingRecord.id, {
        walletType:    "agentWallet",
        agentId:       owner.agentId,
        agentWalletId: agentWallet.id,
        agentTxId:     pendingRecord.id,
        amount,
      });

    } else {
      // Parent / Client: ensure Wallet, create Transaction with PENDING status
      const wallet = await prisma.$transaction(async (tx) =>
        ensureWallet(tx, { parentId: owner.parentId, clientId: owner.clientId })
      );

      pendingRecord = await prisma.transaction.create({
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

      pendingSTK.set("_tx_" + pendingRecord.id, {
        walletType:    "wallet",
        walletId:      wallet.id,
        parentId:      owner.parentId ?? null,
        clientId:      owner.clientId ?? null,
        transactionId: pendingRecord.id,
        amount,
      });
    }

    // ── Call Daraja ──────────────────────────────────────
    let darajaRes;
    try {
      darajaRes = await initiateSTKPush({
        phone,
        amount,
        accountRef:  owner.type === "agentWallet" ? `TRKA${user.id}` : `TRK${user.id}`,
        description: "Wallet TopUp",
      });
    } catch (darajaErr) {
      // Mark failed
      if (owner.type === "agentWallet") {
        await prisma.agentTransaction.update({
          where: { id: pendingRecord.id },
          data:  { description: "M-Pesa top-up FAILED — Daraja unreachable" },
        });
      } else {
        await prisma.transaction.update({ where: { id: pendingRecord.id }, data: { status: "FAILED" } });
      }
      console.error("[stkPush] Daraja error:", darajaErr?.response?.data ?? darajaErr.message);
      return res.status(502).json({ success: false, message: "Could not reach M-Pesa. Please try again." });
    }

    if (darajaRes.ResponseCode !== "0") {
      if (owner.type === "agentWallet") {
        await prisma.agentTransaction.update({ where: { id: pendingRecord.id }, data: { description: "M-Pesa top-up FAILED" } });
      } else {
        await prisma.transaction.update({ where: { id: pendingRecord.id }, data: { status: "FAILED" } });
      }
      return res.status(400).json({ success: false, message: darajaRes.ResponseDescription || "STK Push failed." });
    }

    const checkoutRequestId = darajaRes.CheckoutRequestID;

    // Save CheckoutRequestID on the transaction record
    if (owner.type === "agentWallet") {
      await prisma.agentTransaction.update({ where: { id: pendingRecord.id }, data: { reference: checkoutRequestId } });
      // Re-key the pending map by checkoutRequestId for callback lookup
      const ctx = pendingSTK.get("_agent_tx_" + pendingRecord.id);
      pendingSTK.delete("_agent_tx_" + pendingRecord.id);
      pendingSTK.set(checkoutRequestId, ctx);
    } else {
      await prisma.transaction.update({ where: { id: pendingRecord.id }, data: { reference: checkoutRequestId } });
      const ctx = pendingSTK.get("_tx_" + pendingRecord.id);
      pendingSTK.delete("_tx_" + pendingRecord.id);
      pendingSTK.set(checkoutRequestId, ctx);
    }

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
   ⚠️  PUBLIC — Safaricom posts result here.
   Handles BOTH parent/client wallet and agent wallet.
============================================================ */
export const stkCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode        = Number(callback.ResultCode);

    // Look up pending context
    let p = pendingSTK.get(checkoutRequestId);

    // If not in memory (server restarted), recover from DB
    if (!p) {
      const tx = await prisma.transaction.findFirst({
        where: { reference: checkoutRequestId, status: "PENDING" },
      });
      if (tx) {
        p = { walletType: "wallet", walletId: tx.walletId, transactionId: tx.id, parentId: tx.parentId, clientId: tx.clientId, amount: tx.amount };
      } else {
        const agentTx = await prisma.agentTransaction.findFirst({ where: { reference: checkoutRequestId } });
        if (agentTx) {
          const aw = await prisma.agentWallet.findUnique({ where: { id: agentTx.walletId } });
          p = { walletType: "agentWallet", agentId: aw?.agentId, agentWalletId: agentTx.walletId, agentTxId: agentTx.id, amount: agentTx.amount };
        }
      }
      if (!p) { console.warn("[stkCallback] Unknown CheckoutRequestID:", checkoutRequestId); return; }
    }

    pendingSTK.delete(checkoutRequestId);

    // Extract Safaricom metadata
    const items    = callback.CallbackMetadata?.Item ?? [];
    const getMeta  = (name) => items.find((i) => i.Name === name)?.Value ?? null;
    const paidAmt  = Number(getMeta("Amount")) || p.amount;
    const receipt  = getMeta("MpesaReceiptNumber");

    if (resultCode !== 0) {
      // Payment cancelled / failed
      if (p.walletType === "agentWallet") {
        await prisma.agentTransaction.update({
          where: { id: p.agentTxId },
          data:  { description: `M-Pesa top-up FAILED — ${callback.ResultDesc}` },
        });
      } else {
        await prisma.transaction.update({ where: { id: p.transactionId }, data: { status: "FAILED" } });
      }
      console.log(`[stkCallback] ❌ Payment failed (${resultCode}): ${callback.ResultDesc}`);
      return;
    }

    // ── SUCCESS — credit correct wallet ─────────────────
    if (p.walletType === "agentWallet") {
      await prisma.$transaction([
        prisma.agentWallet.update({ where: { id: p.agentWalletId }, data: { balance: { increment: paidAmt } } }),
        prisma.agentTransaction.update({
          where: { id: p.agentTxId },
          data:  { amount: paidAmt, reference: receipt ?? checkoutRequestId, description: `M-Pesa top-up — ${receipt}`, balanceAfter: (await prisma.agentWallet.findUnique({ where: { id: p.agentWalletId }, select: { balance: true } })).balance + paidAmt },
        }),
      ]);
      console.log(`[stkCallback] ✅ AgentWallet ${p.agentWalletId} +KES ${paidAmt} — receipt: ${receipt}`);
    } else {
      await prisma.$transaction([
        prisma.wallet.update({ where: { id: p.walletId }, data: { balance: { increment: paidAmt } } }),
        prisma.transaction.update({
          where: { id: p.transactionId },
          data:  { amount: paidAmt, status: "SUCCESS", reference: receipt ?? checkoutRequestId },
        }),
      ]);
      console.log(`[stkCallback] ✅ Wallet ${p.walletId} +KES ${paidAmt} — receipt: ${receipt}`);
    }
  } catch (err) {
    console.error("[stkCallback] Error:", err);
  }
};

/* ============================================================
   GET /api/mpesa/stk-status/:checkoutRequestId
   Frontend polls this every 3s. Works for both wallet types.
============================================================ */
export const stkStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    if (!checkoutRequestId) return res.status(400).json({ success: false, message: "checkoutRequestId required." });

    // Check parent/client Transaction first
    const tx = await prisma.transaction.findFirst({
      where:  { reference: checkoutRequestId },
      select: { status: true, amount: true },
    });
    if (tx) return res.status(200).json({ success: true, status: tx.status, amount: tx.amount });

    // Check AgentTransaction
    const agentTx = await prisma.agentTransaction.findFirst({
      where:  { reference: checkoutRequestId },
      select: { description: true, amount: true },
    });
    if (agentTx) {
      const failed  = agentTx.description?.includes("FAILED");
      const success = agentTx.description?.includes("top-up —");
      const status  = failed ? "FAILED" : success ? "SUCCESS" : "PENDING";
      return res.status(200).json({ success: true, status, amount: agentTx.amount });
    }

    // Not yet written — still PENDING
    return res.status(200).json({ success: true, status: "PENDING" });
  } catch (err) {
    console.error("[stkStatus]", err);
    return res.status(500).json({ success: false, message: "Failed to check payment status." });
  }
};

/* ============================================================
   C2B REGISTER — POST /api/mpesa/c2b/register  (ADMIN only)
============================================================ */
export const c2bRegister = async (req, res) => {
  try {
    if (!["ADMIN", "SYSTEM_ADMIN"].includes(req.user?.role?.toUpperCase())) {
      return res.status(403).json({ success: false, message: "ADMIN only." });
    }
    const result = await registerC2BUrls(req.body?.responseType || "Completed");
    return res.status(200).json({ success: true, message: "C2B URLs registered.", data: result });
  } catch (err) {
    console.error("[c2bRegister]", err?.response?.data ?? err.message);
    return res.status(502).json({ success: false, message: "Failed to register C2B URLs.", detail: err?.response?.data });
  }
};

/* ============================================================
   C2B VALIDATE — POST /api/mpesa/c2b/validate  (PUBLIC)
============================================================ */
export const c2bValidate = async (req, res) => {
  const { BillRefNumber } = req.body;
  const userId = extractUserIdFromRef(BillRefNumber);
  if (!userId) return res.status(200).json({ ResultCode: "C2B00011", ResultDesc: "Unknown account reference" });
  return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
};

/* ============================================================
   C2B CONFIRM — POST /api/mpesa/c2b/confirm  (PUBLIC)
   Credits parent/client Wallet OR agent AgentWallet
   based on the BillRefNumber prefix:
     TRK{userId}  → parent or client
     TRKA{userId} → agent
============================================================ */
export const c2bConfirm = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const { TransID, TransAmount, BillRefNumber, MSISDN } = req.body;
    const amount = Number(TransAmount);

    console.log(`[c2bConfirm] receipt: ${TransID}, amount: KES ${amount}, ref: ${BillRefNumber}, phone: ${MSISDN}`);

    // Idempotency check
    const existing = await prisma.transaction.findFirst({ where: { reference: TransID } }) ||
                     await prisma.agentTransaction.findFirst({ where: { reference: TransID } });
    if (existing) { console.warn(`[c2bConfirm] Duplicate TransID: ${TransID}`); return; }

    const isAgent  = /^TRKA/i.test(BillRefNumber);
    const userId   = extractUserIdFromRef(BillRefNumber);
    if (!userId) { console.warn(`[c2bConfirm] Cannot resolve userId from: ${BillRefNumber}`); return; }

    if (isAgent) {
      // Credit AgentWallet
      const agent = await getAgentByUserId(userId);
      if (!agent) { console.warn(`[c2bConfirm] No agent for userId: ${userId}`); return; }
      await creditAgentWallet({ agentId: agent.id, amount, type: "TOPUP", description: `C2B top-up — ${TransID}`, reference: TransID });
      console.log(`[c2bConfirm] ✅ AgentWallet credited KES ${amount} — agent: ${agent.id}`);
    } else {
      // Credit parent or client Wallet
      let owner = null;
      const parent = await getParentByUserId(userId);
      if (parent) { owner = { parentId: parent.id, clientId: null }; }
      else {
        const client = await getClientByUserId(userId);
        if (client) owner = { parentId: null, clientId: client.id };
      }
      if (!owner) { console.warn(`[c2bConfirm] No parent/client for userId: ${userId}`); return; }

      const wallet = await prisma.$transaction(async (tx) =>
        ensureWallet(tx, owner)
      );
      await prisma.$transaction([
        prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
        prisma.transaction.create({
          data: { walletId: wallet.id, parentId: owner.parentId ?? null, clientId: owner.clientId ?? null, amount, type: "DEPOSIT", status: "SUCCESS", reference: TransID },
        }),
      ]);
      console.log(`[c2bConfirm] ✅ Wallet credited KES ${amount} — wallet: ${wallet.id}`);
    }
  } catch (err) {
    console.error("[c2bConfirm] Error:", err);
  }
};

/* ============================================================
   C2B SIMULATE — POST /api/mpesa/c2b/simulate  (sandbox, ADMIN)
============================================================ */
export const c2bSimulate = async (req, res) => {
  try {
    if (process.env.MPESA_ENV === "production") return res.status(403).json({ success: false, message: "Not available in production." });
    if (!["ADMIN", "SYSTEM_ADMIN"].includes(req.user?.role?.toUpperCase())) return res.status(403).json({ success: false, message: "ADMIN only." });
    const { phone, amount, billRef } = req.body;
    if (!phone || !amount) return res.status(400).json({ success: false, message: "phone and amount required." });
    const result = await simulateC2B({ phone, amount: Number(amount), billRef: billRef || "TEST" });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("[c2bSimulate]", err?.response?.data ?? err.message);
    return res.status(502).json({ success: false, message: "Simulation failed.", detail: err?.response?.data });
  }
};

/* ============================================================
   B2C WITHDRAW — POST /api/mpesa/b2c  (AGENT only)
============================================================ */
export const b2cWithdraw = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone?.trim();
    const amount = Number(req.body?.amount);

    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Enter a valid amount." });
    if (user?.role?.toUpperCase() !== "AGENT") return res.status(403).json({ success: false, message: "AGENT accounts only." });

    const agent = await prisma.agent.findFirst({ where: { userId: user.id }, include: { wallet: true } });
    if (!agent) return res.status(404).json({ success: false, message: "Agent profile not found." });

    const agentWallet = agent.wallet;
    if (!agentWallet || agentWallet.balance < amount) {
      return res.status(402).json({ success: false, message: "Insufficient agent wallet balance.", currentBalance: agentWallet?.balance ?? 0, requestedAmount: amount });
    }

    const [updatedWallet, agentTx] = await prisma.$transaction([
      prisma.agentWallet.update({ where: { id: agentWallet.id }, data: { balance: { decrement: amount } } }),
      prisma.agentTransaction.create({
        data: { walletId: agentWallet.id, type: "WITHDRAWAL", amount, description: `M-Pesa withdrawal to ${normalizePhone(phone)}`, reference: null, balanceBefore: agentWallet.balance, balanceAfter: agentWallet.balance - amount },
      }),
    ]);

    let darajaRes;
    try {
      darajaRes = await initiateB2C({ phone, amount, remarks: "TrackMyKid Agent Withdrawal", occasion: "AgentWithdrawal" });
    } catch (darajaErr) {
      await prisma.$transaction([
        prisma.agentWallet.update({ where: { id: agentWallet.id }, data: { balance: { increment: amount } } }),
        prisma.agentTransaction.update({ where: { id: agentTx.id }, data: { description: "Withdrawal reversed — Daraja unreachable" } }),
      ]);
      console.error("[b2cWithdraw] Daraja error:", darajaErr?.response?.data ?? darajaErr.message);
      return res.status(502).json({ success: false, message: "M-Pesa withdrawal failed. Balance restored." });
    }

    await prisma.agentTransaction.update({
      where: { id: agentTx.id },
      data:  { reference: darajaRes.ConversationID ?? darajaRes.OriginatorConversationID },
    });

    return res.status(200).json({ success: true, message: "Withdrawal initiated. Funds will arrive shortly.", newBalance: updatedWallet.balance, conversationId: darajaRes.ConversationID });
  } catch (err) {
    console.error("[b2cWithdraw] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   B2C CALLBACKS  (PUBLIC)
============================================================ */
export const b2cCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const result = req.body?.Result;
    if (!result) return;
    const conversationId = result.ConversationID;
    const resultCode     = Number(result.ResultCode);
    const agentTx        = await prisma.agentTransaction.findFirst({ where: { reference: conversationId } });
    if (!agentTx) { console.warn("[b2cCallback] No matching tx:", conversationId); return; }

    if (resultCode !== 0) {
      await prisma.$transaction([
        prisma.agentWallet.update({ where: { id: agentTx.walletId }, data: { balance: { increment: agentTx.amount } } }),
        prisma.agentTransaction.update({ where: { id: agentTx.id }, data: { description: `Withdrawal FAILED (${resultCode}) — reversed` } }),
      ]);
      console.log(`[b2cCallback] ❌ B2C failed — KES ${agentTx.amount} reversed`);
      return;
    }
    const params  = result.ResultParameters?.ResultParameter ?? [];
    const receipt = params.find((p) => p.Key === "TransactionReceipt")?.Value ?? null;
    await prisma.agentTransaction.update({ where: { id: agentTx.id }, data: { reference: receipt ?? conversationId, description: `Withdrawal SUCCESS — ${receipt}` } });
    console.log(`[b2cCallback] ✅ B2C success — receipt: ${receipt}`);
  } catch (err) { console.error("[b2cCallback] Error:", err); }
};

export const b2cTimeout = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  console.warn("[b2cTimeout] B2C timed out:", JSON.stringify(req.body));
};

/* ============================================================
   PRIVATE HELPERS
============================================================ */
function extractUserIdFromRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/TRKA?-?(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}