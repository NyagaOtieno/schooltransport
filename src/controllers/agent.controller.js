// src/controllers/agent.controller.js
import bcrypt from "bcryptjs";
import prisma from "../middleware/prisma.js";
import {
  getAgentByUserId,
  getAgentWallet,
  creditAgentWallet,
} from "../services/wallet.service.js";
import { initiateSTKPush } from "../services/billing/mpesa.service.js";

// Shared state — no circular import
import { pendingOnboarding } from "../state/billing.state.js";

/* ============================================================
   GET /api/agents/wallet
   Role: AGENT
============================================================ */
export const getWallet = async (req, res) => {
  try {
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    const wallet = await getAgentWallet(agent.id);

    const [lifetimeResult, monthResult] = await Promise.all([
      prisma.agentTransaction.aggregate({
        where: { wallet: { agentId: agent.id }, type: "COMMISSION" },
        _sum:  { amount: true },
      }),
      prisma.agentTransaction.aggregate({
        where: {
          wallet:    { agentId: agent.id },
          type:      "COMMISSION",
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { amount: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        balance:         wallet.balance ?? 0,
        currency:        "KES",
        lifetimeEarned:  lifetimeResult._sum.amount ?? 0,
        thisMonthEarned: monthResult._sum.amount    ?? 0,
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
   Creates Tenant + Admin user + AgentTenant link.
   Then triggers STK push for onboarding fee (non-fatal if it fails).
   Fee is logged in AgentTransaction only — wallet balance unchanged.
   Role: AGENT

   Body: {
     tenantName, county, adminName, adminEmail, adminPassword,
     phone, onboardingFee
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

    // ── Validate required fields ─────────────────────────
    const missing = [];
    if (!tenantName?.trim())    missing.push("tenantName");
    if (!county?.trim())        missing.push("county");
    if (!adminName?.trim())     missing.push("adminName");
    if (!adminEmail?.trim())    missing.push("adminEmail");
    if (!adminPassword?.trim()) missing.push("adminPassword");
    if (!phone?.trim())         missing.push("phone");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const fee = Number(onboardingFee);
    if (!Number.isFinite(fee) || fee < 1) {
      return res.status(400).json({ success: false, message: "A valid onboarding fee is required." });
    }

    // ── Validate email format ─────────────────────────────
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail.trim())) {
      return res.status(400).json({ success: false, message: "Invalid admin email address." });
    }

    // ── Resolve agent ─────────────────────────────────────
    const agent = await getAgentByUserId(req.user.id);
    if (!agent) {
      return res.status(403).json({ success: false, message: "Agent profile not found." });
    }

    // ── Check for duplicate admin email ──────────────────
    const normalizedEmail = adminEmail.trim().toLowerCase();
    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists. Use a different admin email.",
      });
    }

    // ── Create Tenant + Admin + AgentTenant atomically ───
    const hashedPassword = await bcrypt.hash(adminPassword.trim(), 10);

    const tenant = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name:    tenantName.trim(),
          address: county.trim(),
          mode:    "KID",
        },
      });

      await tx.user.create({
        data: {
          name:     adminName.trim(),
          email:    normalizedEmail,
          password: hashedPassword,
          role:     "ADMIN",
          tenantId: newTenant.id,
        },
      });

      await tx.agentTenant.create({
        data: { agentId: agent.id, tenantId: newTenant.id },
      });

      return newTenant;
    });

    // ── Get or create AgentWallet for fee logging ─────────
    let agentWallet = agent.wallet;
    if (!agentWallet) {
      agentWallet = await prisma.agentWallet.create({
        data: { agentId: agent.id, balance: 0 },
      });
    }

    // ── Trigger STK Push (non-fatal) ──────────────────────
    let checkoutRequestId = null;

    try {
      const darajaRes = await initiateSTKPush({
        phone:       phone.trim(),
        amount:      fee,
        accountRef:  `OB${agent.id}-${tenant.id}`,   // prefix "OB" = onboarding fee
        description: "School Onboard",
      });

      if (darajaRes.ResponseCode === "0") {
        checkoutRequestId = darajaRes.CheckoutRequestID;

        // Store in shared map so mpesa.controller stkCallback
        // knows this is an onboarding fee (log only, no wallet credit)
        pendingOnboarding.set(checkoutRequestId, {
          agentId:       agent.id,
          agentWalletId: agentWallet.id,
          tenantId:      tenant.id,
          amount:        fee,
        });
      } else {
        // Daraja rejected — log fee as failed
        await prisma.agentTransaction.create({
          data: {
            walletId:      agentWallet.id,
            type:          "SCHOOL_ONBOARDING_FEE",
            amount:        fee,
            description:   `Onboarding fee for ${tenantName} — STK push rejected`,
            reference:     `OB${agent.id}-${tenant.id}`,
            balanceBefore: agentWallet.balance,
            balanceAfter:  agentWallet.balance,   // balance unchanged
          },
        });
      }
    } catch (darajaErr) {
      // Daraja unreachable — log fee as failed, school still created
      console.error("[createSchool] STK push error:", darajaErr?.response?.data ?? darajaErr.message);
      await prisma.agentTransaction.create({
        data: {
          walletId:      agentWallet.id,
          type:          "SCHOOL_ONBOARDING_FEE",
          amount:        fee,
          description:   `Onboarding fee for ${tenantName} — M-Pesa unreachable`,
          reference:     `OB${agent.id}-${tenant.id}`,
          balanceBefore: agentWallet.balance,
          balanceAfter:  agentWallet.balance,
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: checkoutRequestId
        ? "School created. Enter your M-Pesa PIN to complete the onboarding fee payment."
        : "School created. M-Pesa payment could not be initiated — please contact support.",
      data: {
        tenantId:   tenant.id,
        tenantName: tenant.name,
        county:     tenant.address,
      },
      checkoutRequestId,
    });
  } catch (err) {
    console.error("[agent.createSchool] Error:", err);

    // Surface useful error messages
    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A school or user with these details already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create school. Please try again.",
    });
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
        user:   { select: { id: true, name: true, email: true, phone: true } },
        wallet: { select: { balance: true } },
        tenants: { select: { tenant: { select: { id: true, name: true } } } },
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

/* ============================================================
   POST /api/agents/wallet/topup
   Admin manually credits an agent wallet.
   Role: ADMIN | SYSTEM_ADMIN
   Body: { agentId: number, amount: number }
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
      reference:   `admin-${Date.now()}`,
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