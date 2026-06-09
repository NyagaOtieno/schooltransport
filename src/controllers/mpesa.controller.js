// src/controllers/mpesa.controller.js
import prisma from "../middleware/prisma.js";
import {
  getParentByUserId,
  getClientByUserId,
  getAgentByUserId,
  creditAgentWallet,
} from "../services/wallet.service.js";
import {
  initiateSTKPush,
  initiateB2C,
  normalizePhone,
  registerC2BUrls,
  simulateC2B,
} from "../services/billing/mpesa.service.js";

// Shared state — replaces circular import with agent.controller.js
import { pendingOnboarding, pendingSTK } from "../state/billing.state.js";

/* ============================================================
   HELPERS
============================================================ */
const resolveOwner = async (user) => {
  const role = user?.role?.toUpperCase();
  if (role === "PARENT") {
    const p = await getParentByUserId(user.id);
    return p ? { type: "wallet", parentId: p.id, clientId: null } : null;
  }
  if (role === "CLIENT") {
    const c = await getClientByUserId(user.id);
    return c ? { type: "wallet", parentId: null, clientId: c.id } : null;
  }
  if (role === "AGENT") {
    const a = await getAgentByUserId(user.id);
    return a ? { type: "agentWallet", agentId: a.id, existingWallet: a.wallet } : null;
  }
  return null;
};

const ensureWallet = async (tx, { parentId, clientId }) => {
  const where = parentId ? { parentId } : { clientId };
  let w = await tx.wallet.findFirst({ where });
  if (!w) {
    w = await tx.wallet.create({
      data: { parentId: parentId ?? null, clientId: clientId ?? null, balance: 0 },
    });
  }
  return w;
};

const ensureAgentWallet = async (agentId) => {
  let w = await prisma.agentWallet.findUnique({ where: { agentId } });
  if (!w) w = await prisma.agentWallet.create({ data: { agentId, balance: 0 } });
  return w;
};

function extractUserIdFromRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/TRKA?-?(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/* ============================================================
   POST /api/mpesa/stk-push
   Works for PARENT, CLIENT and AGENT.
   Body: { phone, amount }
============================================================ */
export const stkPush = async (req, res) => {
  try {
    const user   = req.user;
    const phone  = req.body?.phone?.trim();
    const amount = Number(req.body?.amount);

    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });
    if (!Number.isFinite(amount) || amount < 10) {
      return res.status(400).json({ success: false, message: "Minimum deposit is KES 10." });
    }

    const owner = await resolveOwner(user);
    if (!owner) {
      return res.status(403).json({ success: false, message: "PARENT, CLIENT or AGENT accounts only." });
    }

    let pendingCtx = {};

    if (owner.type === "agentWallet") {
      const agentWallet = await ensureAgentWallet(owner.agentId);
      const agentTx = await prisma.agentTransaction.create({
        data: {
          walletId:      agentWallet.id,
          type:          "TOPUP",
          amount,
          description:   "M-Pesa top-up (pending)",
          reference:     null,
          balanceBefore: agentWallet.balance,
          balanceAfter:  agentWallet.balance + amount,
        },
      });
      pendingCtx = {
        walletType:    "agentWallet",
        agentId:       owner.agentId,
        agentWalletId: agentWallet.id,
        agentTxId:     agentTx.id,
        amount,
      };
    } else {
      const wallet = await prisma.$transaction(async (tx) =>
        ensureWallet(tx, { parentId: owner.parentId, clientId: owner.clientId })
      );
      const dbTx = await prisma.transaction.create({
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
      pendingCtx = {
        walletType:    "wallet",
        walletId:      wallet.id,
        parentId:      owner.parentId ?? null,
        clientId:      owner.clientId ?? null,
        transactionId: dbTx.id,
        amount,
      };
    }

    let darajaRes;
    try {
      darajaRes = await initiateSTKPush({
        phone,
        amount,
        accountRef:  owner.type === "agentWallet" ? `TRKA${user.id}` : `TRK${user.id}`,
        description: "Wallet TopUp",
      });
    } catch (darajaErr) {
      if (owner.type === "agentWallet") {
        await prisma.agentTransaction.update({ where: { id: pendingCtx.agentTxId }, data: { description: "M-Pesa top-up FAILED" } });
      } else {
        await prisma.transaction.update({ where: { id: pendingCtx.transactionId }, data: { status: "FAILED" } });
      }
      console.error("[stkPush] Daraja error:", darajaErr?.response?.data ?? darajaErr.message);
      return res.status(502).json({ success: false, message: "Could not reach M-Pesa. Please try again." });
    }

    if (darajaRes.ResponseCode !== "0") {
      if (owner.type === "agentWallet") {
        await prisma.agentTransaction.update({ where: { id: pendingCtx.agentTxId }, data: { description: "M-Pesa top-up FAILED" } });
      } else {
        await prisma.transaction.update({ where: { id: pendingCtx.transactionId }, data: { status: "FAILED" } });
      }
      return res.status(400).json({ success: false, message: darajaRes.ResponseDescription || "STK Push failed." });
    }

    const checkoutRequestId = darajaRes.CheckoutRequestID;

    if (owner.type === "agentWallet") {
      await prisma.agentTransaction.update({ where: { id: pendingCtx.agentTxId }, data: { reference: checkoutRequestId } });
    } else {
      await prisma.transaction.update({ where: { id: pendingCtx.transactionId }, data: { reference: checkoutRequestId } });
    }

    pendingSTK.set(checkoutRequestId, { ...pendingCtx, checkoutRequestId });

    return res.status(200).json({
      success:           true,
      message:           "STK Push sent — enter your M-Pesa PIN.",
      checkoutRequestId,
      merchantRequestId: darajaRes.MerchantRequestID,
    });
  } catch (err) {
    console.error("[stkPush]", err);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
};

/* ============================================================
   POST /api/mpesa/stk-callback
   ⚠️  PUBLIC — Safaricom posts result here.
   Handles: wallet top-up, agent top-up, school onboarding fee.
============================================================ */
export const stkCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode        = Number(callback.ResultCode);
    const items             = callback.CallbackMetadata?.Item ?? [];
    const getMeta           = (name) => items.find((i) => i.Name === name)?.Value ?? null;
    const paidAmt           = Number(getMeta("Amount"));
    const receipt           = getMeta("MpesaReceiptNumber");

    // ── School onboarding fee — log only, no wallet credit ─
    if (pendingOnboarding.has(checkoutRequestId)) {
      const ctx          = pendingOnboarding.get(checkoutRequestId);
      pendingOnboarding.delete(checkoutRequestId);
      const walletRecord = await prisma.agentWallet.findUnique({ where: { id: ctx.agentWalletId }, select: { balance: true } });
      const bal          = walletRecord?.balance ?? 0;

      await prisma.agentTransaction.create({
        data: {
          walletId:      ctx.agentWalletId,
          type:          "SCHOOL_ONBOARDING_FEE",
          amount:        paidAmt || ctx.amount,
          description:   resultCode === 0
            ? `Onboarding fee — school ${ctx.tenantId} — receipt: ${receipt}`
            : `Onboarding fee FAILED (${resultCode}) — school ${ctx.tenantId}`,
          reference:     receipt ?? checkoutRequestId,
          balanceBefore: bal,
          balanceAfter:  bal,   // balance unchanged — fee is informational only
        },
      });
      console.log(`[stkCallback][onboarding] ${resultCode === 0 ? "✅" : "❌"} fee ${paidAmt} — school ${ctx.tenantId}`);
      return;
    }

    // ── Regular wallet top-up ────────────────────────────
    let p = pendingSTK.get(checkoutRequestId);

    // Recovery after server restart
    if (!p) {
      const tx = await prisma.transaction.findFirst({ where: { reference: checkoutRequestId, status: "PENDING" } });
      if (tx) {
        p = { walletType: "wallet", walletId: tx.walletId, transactionId: tx.id, parentId: tx.parentId, clientId: tx.clientId, amount: tx.amount };
      } else {
        const atx = await prisma.agentTransaction.findFirst({ where: { reference: checkoutRequestId } });
        if (atx) {
          const aw = await prisma.agentWallet.findUnique({ where: { id: atx.walletId } });
          p = { walletType: "agentWallet", agentId: aw?.agentId, agentWalletId: atx.walletId, agentTxId: atx.id, amount: atx.amount };
        }
      }
      if (!p) { console.warn("[stkCallback] Unknown CheckoutRequestID:", checkoutRequestId); return; }
    }

    pendingSTK.delete(checkoutRequestId);
    const finalAmount = paidAmt || p.amount;

    if (resultCode !== 0) {
      if (p.walletType === "agentWallet") {
        await prisma.agentTransaction.update({ where: { id: p.agentTxId }, data: { description: `M-Pesa top-up FAILED — ${callback.ResultDesc}` } });
      } else {
        await prisma.transaction.update({ where: { id: p.transactionId }, data: { status: "FAILED" } });
      }
      console.log(`[stkCallback] ❌ Failed (${resultCode})`);
      return;
    }

    if (p.walletType === "agentWallet") {
      const currentWallet = await prisma.agentWallet.findUnique({ where: { id: p.agentWalletId }, select: { balance: true } });
      await prisma.$transaction([
        prisma.agentWallet.update({ where: { id: p.agentWalletId }, data: { balance: { increment: finalAmount } } }),
        prisma.agentTransaction.update({ where: { id: p.agentTxId }, data: { amount: finalAmount, reference: receipt ?? checkoutRequestId, description: `M-Pesa top-up — ${receipt}`, balanceAfter: (currentWallet?.balance ?? 0) + finalAmount } }),
      ]);
      console.log(`[stkCallback] ✅ AgentWallet ${p.agentWalletId} +KES ${finalAmount}`);
    } else {
      await prisma.$transaction([
        prisma.wallet.update({ where: { id: p.walletId }, data: { balance: { increment: finalAmount } } }),
        prisma.transaction.update({ where: { id: p.transactionId }, data: { amount: finalAmount, status: "SUCCESS", reference: receipt ?? checkoutRequestId } }),
      ]);
      console.log(`[stkCallback] ✅ Wallet ${p.walletId} +KES ${finalAmount}`);
    }
  } catch (err) {
    console.error("[stkCallback]", err);
  }
};

/* ============================================================
   GET /api/mpesa/stk-status/:checkoutRequestId
============================================================ */
export const stkStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    if (!checkoutRequestId) return res.status(400).json({ success: false, message: "checkoutRequestId required." });

    const tx = await prisma.transaction.findFirst({ where: { reference: checkoutRequestId }, select: { status: true, amount: true } });
    if (tx) return res.status(200).json({ success: true, status: tx.status, amount: tx.amount });

    const atx = await prisma.agentTransaction.findFirst({ where: { reference: checkoutRequestId }, select: { description: true, amount: true } });
    if (atx) {
      const desc   = atx.description ?? "";
      const status = desc.includes("FAILED") ? "FAILED" : desc.includes("pending") ? "PENDING" : "SUCCESS";
      return res.status(200).json({ success: true, status, amount: atx.amount });
    }

    return res.status(200).json({ success: true, status: "PENDING" });
  } catch (err) {
    console.error("[stkStatus]", err);
    return res.status(500).json({ success: false, message: "Failed to check status." });
  }
};

/* ============================================================
   C2B REGISTER — POST /api/mpesa/c2b/register  (ADMIN)
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
    return res.status(502).json({ success: false, message: "Failed.", detail: err?.response?.data });
  }
};

/* ============================================================
   C2B VALIDATE — POST /api/mpesa/c2b/validate  (PUBLIC)
============================================================ */
export const c2bValidate = async (req, res) => {
  const userId = extractUserIdFromRef(req.body?.BillRefNumber);
  if (!userId) return res.status(200).json({ ResultCode: "C2B00011", ResultDesc: "Unknown reference" });
  return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
};

/* ============================================================
   C2B CONFIRM — POST /api/mpesa/c2b/confirm  (PUBLIC)
   TRK{userId}  → parent/client wallet
   TRKA{userId} → agent wallet
============================================================ */
export const c2bConfirm = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const { TransID, TransAmount, BillRefNumber, MSISDN } = req.body;
    const amount  = Number(TransAmount);
    const isAgent = /^TRKA/i.test(String(BillRefNumber ?? ""));
    const userId  = extractUserIdFromRef(BillRefNumber);
    if (!userId) { console.warn(`[c2bConfirm] Unknown ref: ${BillRefNumber}`); return; }

    const dup = await prisma.transaction.findFirst({ where: { reference: TransID } }) ||
                await prisma.agentTransaction.findFirst({ where: { reference: TransID } });
    if (dup) { console.warn(`[c2bConfirm] Duplicate: ${TransID}`); return; }

    if (isAgent) {
      const agent = await getAgentByUserId(userId);
      if (!agent) { console.warn(`[c2bConfirm] No agent for userId:${userId}`); return; }
      await creditAgentWallet({ agentId: agent.id, amount, type: "TOPUP", description: `C2B top-up — ${TransID}`, reference: TransID });
      console.log(`[c2bConfirm] ✅ AgentWallet +KES ${amount}`);
    } else {
      let owner = null;
      const parent = await getParentByUserId(userId);
      if (parent) owner = { parentId: parent.id, clientId: null };
      else { const client = await getClientByUserId(userId); if (client) owner = { parentId: null, clientId: client.id }; }
      if (!owner) { console.warn(`[c2bConfirm] No parent/client for userId:${userId}`); return; }
      const wallet = await prisma.$transaction(async (tx) => ensureWallet(tx, owner));
      await prisma.$transaction([
        prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
        prisma.transaction.create({ data: { walletId: wallet.id, parentId: owner.parentId ?? null, clientId: owner.clientId ?? null, amount, type: "DEPOSIT", status: "SUCCESS", reference: TransID } }),
      ]);
      console.log(`[c2bConfirm] ✅ Wallet +KES ${amount}`);
    }
  } catch (err) { console.error("[c2bConfirm]", err); }
};

/* ============================================================
   C2B SIMULATE — POST /api/mpesa/c2b/simulate  (sandbox, ADMIN)
============================================================ */
export const c2bSimulate = async (req, res) => {
  try {
    if (process.env.MPESA_ENV === "production") return res.status(403).json({ success: false, message: "Not in production." });
    if (!["ADMIN", "SYSTEM_ADMIN"].includes(req.user?.role?.toUpperCase())) return res.status(403).json({ success: false, message: "ADMIN only." });
    const { phone, amount, billRef } = req.body;
    if (!phone || !amount) return res.status(400).json({ success: false, message: "phone and amount required." });
    const result = await simulateC2B({ phone, amount: Number(amount), billRef: billRef || "TEST" });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(502).json({ success: false, message: "Simulation failed.", detail: err?.response?.data });
  }
};

/* ============================================================
   B2C WITHDRAW — POST /api/mpesa/b2c
   AGENT: automated (no admin approval)
   PARENT/CLIENT: blocked — admin must approve
============================================================ */
export const b2cWithdraw = async (req, res) => {
  try {
    const user   = req.user;
    const role   = user?.role?.toUpperCase();
    const phone  = req.body?.phone?.trim();
    const amount = Number(req.body?.amount);

    if (!phone) return res.status(400).json({ success: false, message: "Phone is required." });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Enter a valid amount." });

    if (role === "PARENT" || role === "CLIENT") {
      return res.status(403).json({
        success: false,
        message: "Wallet refunds require admin approval. Please contact support.",
        code:    "ADMIN_APPROVAL_REQUIRED",
      });
    }

    if (!["AGENT", "ADMIN", "SYSTEM_ADMIN"].includes(role)) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const agentId = role === "AGENT"
      ? (await getAgentByUserId(user.id))?.id
      : Number(req.body?.agentId);

    if (!agentId) return res.status(404).json({ success: false, message: "Agent not found." });

    const agentWallet = await prisma.agentWallet.findUnique({ where: { agentId } });
    if (!agentWallet) return res.status(404).json({ success: false, message: "Agent wallet not found." });
    if (agentWallet.balance < amount) {
      return res.status(402).json({
        success:         false,
        message:         `Insufficient balance. Available: KES ${agentWallet.balance.toLocaleString()}`,
        currentBalance:  agentWallet.balance,
        requestedAmount: amount,
      });
    }

    const [updatedWallet, agentTx] = await prisma.$transaction([
      prisma.agentWallet.update({ where: { id: agentWallet.id }, data: { balance: { decrement: amount } } }),
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

    return res.status(200).json({
      success:        true,
      message:        "Withdrawal initiated. Funds will arrive within minutes.",
      newBalance:     updatedWallet.balance,
      conversationId: darajaRes.ConversationID,
    });
  } catch (err) {
    console.error("[b2cWithdraw]", err);
    return res.status(500).json({ success: false, message: "Unexpected error." });
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
    const { ConversationID, ResultCode: rc } = result;
    const resultCode = Number(rc);
    const agentTx = await prisma.agentTransaction.findFirst({ where: { reference: ConversationID } });
    if (!agentTx) { console.warn("[b2cCallback] No matching tx:", ConversationID); return; }
    if (resultCode !== 0) {
      await prisma.$transaction([
        prisma.agentWallet.update({ where: { id: agentTx.walletId }, data: { balance: { increment: agentTx.amount } } }),
        prisma.agentTransaction.update({ where: { id: agentTx.id }, data: { description: `Withdrawal FAILED (${resultCode}) — automatically reversed` } }),
      ]);
      console.log(`[b2cCallback] ❌ KES ${agentTx.amount} reversed`); return;
    }
    const params  = result.ResultParameters?.ResultParameter ?? [];
    const receipt = params.find((p) => p.Key === "TransactionReceipt")?.Value ?? null;
    await prisma.agentTransaction.update({ where: { id: agentTx.id }, data: { reference: receipt ?? ConversationID, description: `Withdrawal SUCCESS — ${receipt}` } });
    console.log(`[b2cCallback] ✅ receipt: ${receipt}`);
  } catch (err) { console.error("[b2cCallback]", err); }
};

export const b2cTimeout = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  console.warn("[b2cTimeout]", JSON.stringify(req.body));
};