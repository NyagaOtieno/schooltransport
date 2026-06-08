// src/controllers/agent.controller.js
import bcrypt from "bcryptjs";
import prisma from "../middleware/prisma.js";
import {
  getAgentByUserId,
  getAgentWallet,
  creditAgentWallet,
  deductAgentWallet,
} from "../services/wallet.service.js";
import {
  initiateSTKPush,
  normalizePhone,
} from "../services/billing/mpesa.service.js";

/* ============================================================
   PENDING ONBOARDING MAP
   checkoutRequestId → { agentId, agentWalletId, amount, tenantId }
   Cleared after callback or timeout.
============================================================ */
const pendingOnboarding = new Map();

/* ============================================================
   GET /api/agents/wallet
   Returns agent wallet balance + lifetime + this month earned.
   Role: AGENT
============================================================ */
export const getWallet = async (req, res) => {
  try {
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    const wallet = await getAgentWallet(agent.id);

    // Lifetime commissions earned
    const lifetimeResult = await prisma.agentTransaction.aggregate({
      where:  { wallet: { agentId: agent.id }, type: "COMMISSION" },
      _sum:   { amount: true },
    });

    // This month commissions
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthResult = await prisma.agentTransaction.aggregate({
      where: {
        wallet:    { agentId: agent.id },
        type:      "COMMISSION",
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    return res.status(200).json({
      success: true,
      data: {
        balance:         wallet.balance ?? 0,
        currency:        "KES",
        lifetimeEarned:  lifetimeResult._sum.amount ?? 0,
        thisMonthEarned: monthResult._sum.amount ?? 0,
      },
    });
  } catch (err) {
    console.error("[agent.getWallet]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch wallet." });
  }
};

/* ============================================================
   GET /api/agents/wallet/transactions?page=1&limit=20
   Role: AGENT
============================================================ */
export const getWalletTransactions = async (req, res) => {
  try {
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    const wallet = await getAgentWallet(agent.id);
    if (!wallet.id) {
      return res.status(200).json({ success: true, data: [], total: 0, page: 1, limit: 20 });
    }

    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const [txs, total] = await Promise.all([
      prisma.agentTransaction.findMany({
        where:   { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.agentTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return res.status(200).json({ success: true, data: txs, total, page, limit });
  } catch (err) {
    console.error("[agent.getWalletTransactions]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch transactions." });
  }
};

/* ============================================================
   GET /api/agents/schools
   Returns all tenants onboarded by this agent.
   Role: AGENT
============================================================ */
export const getSchools = async (req, res) => {
  try {
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    const agentTenants = await prisma.agentTenant.findMany({
      where:   { agentId: agent.id },
      include: {
        tenant: {
          include: {
            _count: { select: { students: true, buses: true, users: true } },
          },
        },
      },
      orderBy: { onboardedAt: "desc" },
    });

    const schools = agentTenants.map((at) => ({
      id:          at.tenant.id,
      name:        at.tenant.name,
      county:      at.tenant.address ?? "",
      logoUrl:     at.tenant.logoUrl  ?? null,
      phone:       at.tenant.phone    ?? "",
      students:    at.tenant._count.students,
      buses:       at.tenant._count.buses,
      staff:       at.tenant._count.users,
      onboardedAt: at.onboardedAt,
      mode:        at.tenant.mode,
    }));

    return res.status(200).json({ success: true, data: schools });
  } catch (err) {
    console.error("[agent.getSchools]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch schools." });
  }
};

/* ============================================================
   POST /api/agents/create-school
   Creates a new Tenant + Admin user + AgentTenant link.
   Then triggers STK Push for the onboarding fee.
   Onboarding fee is logged in AgentTransaction (NOT credited to wallet).
   Role: AGENT

   Body: {
     tenantName, county, adminName, adminEmail, adminPassword,
     phone,          // M-Pesa phone for STK push
     onboardingFee   // amount to pay
   }
============================================================ */
export const createSchool = async (req, res) => {
  try {
    const {
      tenantName,
      county,
      adminName,
      adminEmail,
      adminPassword,
      phone,
      onboardingFee,
    } = req.body;

    // ── Validate required fields ───────────────────────────
    if (!tenantName?.trim()) {
      return res.status(400).json({ success: false, message: "School name is required." });
    }
    if (!county?.trim()) {
      return res.status(400).json({ success: false, message: "County is required." });
    }
    if (!adminName?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
      return res.status(400).json({ success: false, message: "Admin name, email and password are required." });
    }
    if (!phone?.trim()) {
      return res.status(400).json({ success: false, message: "M-Pesa phone number is required." });
    }

    const fee = Number(onboardingFee);
    if (!Number.isFinite(fee) || fee < 1) {
      return res.status(400).json({ success: false, message: "A valid onboarding fee is required." });
    }

    // ── Resolve agent ──────────────────────────────────────
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(403).json({ success: false, message: "Agent profile not found." });
    }

    // ── Check for duplicate admin email ────────────────────
    const existingEmail = await prisma.user.findFirst({
      where: { email: adminEmail.trim().toLowerCase() },
    });
    if (existingEmail) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }

    // ── Create Tenant + Admin user in one transaction ──────
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const tenant = await prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const newTenant = await tx.tenant.create({
        data: {
          name:    tenantName.trim(),
          address: county.trim(),
          mode:    "KID",
        },
      });

      // 2. Create admin user for this tenant
      await tx.user.create({
        data: {
          name:     adminName.trim(),
          email:    adminEmail.trim().toLowerCase(),
          password: hashedPassword,
          role:     "ADMIN",
          tenantId: newTenant.id,
        },
      });

      // 3. Link agent to tenant
      await tx.agentTenant.create({
        data: { agentId: agent.id, tenantId: newTenant.id },
      });

      return newTenant;
    });

    // ── Get or create agent wallet for transaction logging ──
    let agentWallet = agent.wallet;
    if (!agentWallet) {
      agentWallet = await prisma.agentWallet.create({
        data: { agentId: agent.id, balance: 0 },
      });
    }

    // ── Trigger STK Push for onboarding fee ────────────────
    let checkoutRequestId = null;

    try {
      const darajaRes = await initiateSTKPush({
        phone,
        amount:      fee,
        accountRef:  `OB-${tenant.id}`,
        description: "School Onboarding",
      });

      if (darajaRes.ResponseCode === "0") {
        checkoutRequestId = darajaRes.CheckoutRequestID;

        // Store context for callback — onboarding fees don't credit wallet
        pendingOnboarding.set(checkoutRequestId, {
          agentId:       agent.id,
          agentWalletId: agentWallet.id,
          tenantId:      tenant.id,
          amount:        fee,
        });
      }
    } catch (darajaErr) {
      // STK push failed — school still created, just log fee as PENDING manually
      console.error("[createSchool] STK push error:", darajaErr?.response?.data ?? darajaErr.message);

      await prisma.agentTransaction.create({
        data: {
          walletId:      agentWallet.id,
          type:          "SCHOOL_ONBOARDING_FEE",
          amount:        fee,
          description:   `Onboarding fee for ${tenantName} — payment failed`,
          reference:     `OB-${tenant.id}`,
          balanceBefore: agentWallet.balance,
          balanceAfter:  agentWallet.balance,  // balance unchanged
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: checkoutRequestId
        ? "School created. Enter your M-Pesa PIN to complete payment."
        : "School created. Payment could not be initiated — please retry.",
      data: {
        tenantId:   tenant.id,
        tenantName: tenant.name,
        county:     tenant.address,
      },
      checkoutRequestId,  // frontend polls this for payment status
    });
  } catch (err) {
    console.error("[agent.createSchool]", err);
    return res.status(500).json({ success: false, message: "Failed to create school." });
  }
};

/* ============================================================
   POST /api/mpesa/onboarding-callback  (called internally)
   Handle STK callback for onboarding fee.
   Does NOT credit AgentWallet — only logs AgentTransaction.
============================================================ */
export const handleOnboardingCallback = async (checkoutRequestId, resultCode, paidAmount, receipt) => {
  const ctx = pendingOnboarding.get(checkoutRequestId);
  if (!ctx) return;

  pendingOnboarding.delete(checkoutRequestId);

  const balanceBefore = (await prisma.agentWallet.findUnique({
    where: { id: ctx.agentWalletId }, select: { balance: true },
  }))?.balance ?? 0;

  await prisma.agentTransaction.create({
    data: {
      walletId:      ctx.agentWalletId,
      type:          "SCHOOL_ONBOARDING_FEE",
      amount:        paidAmount,
      description:   resultCode === 0
        ? `Onboarding fee — school ${ctx.tenantId} — receipt: ${receipt}`
        : `Onboarding fee FAILED (code ${resultCode}) — school ${ctx.tenantId}`,
      reference:     receipt ?? checkoutRequestId,
      balanceBefore,
      balanceAfter:  balanceBefore,  // ← balance does NOT change
    },
  });

  console.log(`[onboarding] ${resultCode === 0 ? "✅" : "❌"} Fee ${paidAmount} logged for school ${ctx.tenantId}`);
};

/* expose map for mpesa controller to check */
export { pendingOnboarding };

/* ============================================================
   POST /api/agents/wallet/topup  (manual admin credit)
   Role: ADMIN | SYSTEM_ADMIN
   Body: { agentId, amount }
============================================================ */
export const adminCreditAgentWallet = async (req, res) => {
  try {
    const role = req.user?.role?.toUpperCase();
    if (!["ADMIN", "SYSTEM_ADMIN"].includes(role)) {
      return res.status(403).json({ success: false, message: "ADMIN only." });
    }

    const agentId = Number(req.body?.agentId);
    const amount  = Number(req.body?.amount);

    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(400).json({ success: false, message: "Valid agentId is required." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid amount is required." });
    }

    const wallet = await creditAgentWallet({
      agentId,
      amount,
      type:        "TOPUP",
      description: `Manual credit by admin ${req.user.id}`,
      reference:   `admin-credit-${Date.now()}`,
    });

    return res.status(200).json({
      success: true,
      message: `KES ${amount} credited to agent wallet.`,
      balance: wallet.balance,
    });
  } catch (err) {
    console.error("[agent.adminCreditAgentWallet]", err);
    return res.status(500).json({ success: false, message: "Failed to credit wallet." });
  }
};

/* ============================================================
   GET /api/agents/profile
   Role: AGENT
============================================================ */
export const getProfile = async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where:   { userId: req.user.id },
      include: {
        user:    { select: { id: true, name: true, email: true, phone: true } },
        wallet:  { select: { balance: true } },
        tenants: { include: { tenant: { select: { id: true, name: true } } } },
      },
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    return res.status(200).json({
      success: true,
      data: {
        id:             agent.id,
        name:           agent.user?.name,
        email:          agent.user?.email,
        phone:          agent.user?.phone,
        commissionRate: agent.commissionRate,
        isActive:       agent.isActive,
        walletBalance:  agent.wallet?.balance ?? 0,
        schoolCount:    agent.tenants.length,
      },
    });
  } catch (err) {
    console.error("[agent.getProfile]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch profile." });
  }
};