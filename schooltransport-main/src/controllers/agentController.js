// src/controllers/agent.controller.js
import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  getOrCreateAgentWallet,
  creditAgentWallet,
  deductAgentWallet,
  agentInclude,
} from "../services/agent.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStrongPassword(p) {
  return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, tenantId: user.tenantId ?? null },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ── SYSTEM ADMIN guard (used inside controllers) ──────────────────────────────

function assertSystemAdmin(req, res) {
  const r = req.user?.role;
  if (r !== "SYSTEM_ADMIN" && r !== "ADMIN") {
    res.status(403).json({ error: "Forbidden. System Admin access required." });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// CREATE SYSTEM ADMIN (one-time bootstrap via env secret)
// POST /api/agents/bootstrap-system-admin
// Body: { name, email, password, secret }
// ═══════════════════════════════════════════════════════════════════
export const bootstrapSystemAdmin = async (req, res) => {
  try {
    const { name, email, password, secret } = req.body;

    if (!secret || secret !== process.env.SYSTEM_ADMIN_SECRET) {
      return res.status(403).json({ error: "Invalid system secret." });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required." });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: "Password must be 8+ chars with uppercase, lowercase and a digit.",
      });
    }

    const existing = await prisma.user.findFirst({ where: { email, tenantId: null } });
    if (existing) return res.status(409).json({ error: "System admin already exists." });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role: "SYSTEM_ADMIN", tenantId: null },
    });

    return res.status(201).json({
      success: true,
      message: "System admin created.",
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("[bootstrapSystemAdmin]", err);
    return res.status(500).json({ error: "Failed to create system admin." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// CREATE AGENT
// POST /api/agents
// Auth: SYSTEM_ADMIN or ADMIN
// Body: { name, email, phone, password, commissionRate? }
// ═══════════════════════════════════════════════════════════════════
export const createAgent = async (req, res) => {
  try {
    if (!assertSystemAdmin(req, res)) return;

    const { name, email, phone, password, commissionRate = 0.10 } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required." });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: "Password must be 8+ chars with uppercase, lowercase and a digit.",
      });
    }

    const existing = await prisma.user.findFirst({ where: { email, tenantId: null } });
    if (existing) return res.status(409).json({ error: "Email already registered as a platform user." });

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone:    phone ?? null,
        password: hashed,
        role:     "AGENT",
        tenantId: null,       // platform-level — no tenant
      },
    });

    const agent = await prisma.agent.create({
      data: {
        userId:        user.id,
        commissionRate: Number(commissionRate),
        isActive:      true,
      },
      include: agentInclude,
    });

    // Auto-create wallet
    await getOrCreateAgentWallet(agent.id);

    return res.status(201).json({
      success: true,
      message: "Agent created successfully.",
      data:    agent,
    });
  } catch (err) {
    console.error("[createAgent]", err);
    return res.status(500).json({ error: "Failed to create agent." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// LIST ALL AGENTS
// GET /api/agents
// Auth: SYSTEM_ADMIN or ADMIN
// ═══════════════════════════════════════════════════════════════════
export const listAgents = async (req, res) => {
  try {
    if (!assertSystemAdmin(req, res)) return;

    const agents = await prisma.agent.findMany({
      include: agentInclude,
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: agents });
  } catch (err) {
    console.error("[listAgents]", err);
    return res.status(500).json({ error: "Failed to list agents." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// GET AGENT BY ID
// GET /api/agents/:id
// Auth: SYSTEM_ADMIN or self (agent viewing own profile)
// ═══════════════════════════════════════════════════════════════════
export const getAgent = async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const role    = req.user?.role;
    const userId  = req.user?.userId;

    const agent = await prisma.agent.findUnique({
      where:   { id: agentId },
      include: agentInclude,
    });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    // Allow self-access
    const isSelf  = agent.userId === userId;
    const isAdmin = role === "SYSTEM_ADMIN" || role === "ADMIN";
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden." });

    return res.json({ success: true, data: agent });
  } catch (err) {
    console.error("[getAgent]", err);
    return res.status(500).json({ error: "Failed to get agent." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// UPDATE AGENT
// PUT /api/agents/:id
// Auth: SYSTEM_ADMIN or self
// ═══════════════════════════════════════════════════════════════════
export const updateAgent = async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const userId  = req.user?.userId;
    const role    = req.user?.role;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const isSelf  = agent.userId === userId;
    const isAdmin = role === "SYSTEM_ADMIN" || role === "ADMIN";
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden." });

    const { commissionRate, isActive, name, phone } = req.body;

    // Update user fields if provided
    if (name || phone) {
      await prisma.user.update({
        where: { id: agent.userId },
        data:  { ...(name && { name }), ...(phone && { phone }) },
      });
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(commissionRate !== undefined && { commissionRate: Number(commissionRate) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
      include: agentInclude,
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[updateAgent]", err);
    return res.status(500).json({ error: "Failed to update agent." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// DELETE AGENT
// DELETE /api/agents/:id
// Auth: SYSTEM_ADMIN only
// ═══════════════════════════════════════════════════════════════════
export const deleteAgent = async (req, res) => {
  try {
    if (!assertSystemAdmin(req, res)) return;

    const agentId = Number(req.params.id);
    const agent   = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    // Delete user (cascade deletes Agent + AgentWallet via FK)
    await prisma.user.delete({ where: { id: agent.userId } });

    return res.json({ success: true, message: "Agent deleted." });
  } catch (err) {
    console.error("[deleteAgent]", err);
    return res.status(500).json({ error: "Failed to delete agent." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT CREATES A SCHOOL (Tenant + Admin User)
// POST /api/agents/create-school
// Auth: AGENT (self) or SYSTEM_ADMIN
// Body: { tenantName, mode, adminName, adminEmail, adminPassword, adminPhone? }
// ═══════════════════════════════════════════════════════════════════
export const createSchool = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role   = req.user?.role;

    if (role !== "AGENT" && role !== "SYSTEM_ADMIN" && role !== "ADMIN") {
      return res.status(403).json({ error: "Only agents or admins can create schools." });
    }

    const { tenantName, mode = "KID", adminName, adminEmail, adminPassword, adminPhone } = req.body;

    if (!tenantName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({
        error: "tenantName, adminName, adminEmail and adminPassword are required.",
      });
    }
    if (!isStrongPassword(adminPassword)) {
      return res.status(400).json({
        error: "Admin password must be 8+ chars with uppercase, lowercase and digit.",
      });
    }
    if (!["KID", "ASSET"].includes(mode.toUpperCase())) {
      return res.status(400).json({ error: "mode must be KID or ASSET." });
    }

    const hashed = await bcrypt.hash(adminPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Tenant
      const tenant = await tx.tenant.create({
        data: { name: tenantName, mode: mode.toUpperCase() },
      });

      // 2. Check admin email uniqueness within this tenant
      const emailExists = await tx.user.findFirst({
        where: { email: adminEmail, tenantId: tenant.id },
      });
      if (emailExists) throw new Error(`Email ${adminEmail} already exists in this tenant.`);

      // 3. Create Admin User
      const adminUser = await tx.user.create({
        data: {
          name:     adminName,
          email:    adminEmail,
          phone:    adminPhone ?? null,
          password: hashed,
          role:     "ADMIN",
          tenantId: tenant.id,
        },
      });

      // 4. Link school to agent (if caller is an AGENT)
      if (role === "AGENT") {
        const agent = await tx.agent.findUnique({ where: { userId } });
        if (agent) {
          await tx.agentTenant.create({
            data: { agentId: agent.id, tenantId: tenant.id },
          });
        }
      }

      return { tenant, adminUser };
    });

    return res.status(201).json({
      success: true,
      message: `School "${tenantName}" created with Admin user.`,
      data: {
        tenant: {
          id:   result.tenant.id,
          name: result.tenant.name,
          mode: result.tenant.mode,
        },
        admin: {
          id:    result.adminUser.id,
          name:  result.adminUser.name,
          email: result.adminUser.email,
          role:  result.adminUser.role,
        },
      },
    });
  } catch (err) {
    console.error("[createSchool]", err);
    if (err.message?.includes("already exists")) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to create school." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// GET AGENT'S SCHOOLS
// GET /api/agents/my-schools
// Auth: AGENT (own) or SYSTEM_ADMIN (all)
// ═══════════════════════════════════════════════════════════════════
export const getMySchools = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role   = req.user?.role;

    let agentTenants;

    if (role === "AGENT") {
      const agent = await prisma.agent.findUnique({ where: { userId } });
      if (!agent) return res.status(404).json({ error: "Agent profile not found." });

      agentTenants = await prisma.agentTenant.findMany({
        where: { agentId: agent.id },
        include: {
          tenant: {
            include: {
              _count: { select: { students: true, users: true, buses: true } },
            },
          },
        },
        orderBy: { onboardedAt: "desc" },
      });
    } else if (role === "SYSTEM_ADMIN" || role === "ADMIN") {
      agentTenants = await prisma.agentTenant.findMany({
        include: {
          tenant: {
            include: {
              _count: { select: { students: true, users: true, buses: true } },
            },
          },
          agent: { include: { user: { select: { name: true, email: true } } } },
        },
        orderBy: { onboardedAt: "desc" },
      });
    } else {
      return res.status(403).json({ error: "Forbidden." });
    }

    return res.json({ success: true, data: agentTenants });
  } catch (err) {
    console.error("[getMySchools]", err);
    return res.status(500).json({ error: "Failed to get schools." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT DASHBOARD STATS
// GET /api/agents/dashboard
// Auth: AGENT (own) or SYSTEM_ADMIN
// ═══════════════════════════════════════════════════════════════════
export const getDashboard = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role   = req.user?.role;

    if (role !== "AGENT" && role !== "SYSTEM_ADMIN" && role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden." });
    }

    const agent = await prisma.agent.findUnique({
      where:   { userId },
      include: { wallet: true, tenants: { include: { tenant: { include: { _count: { select: { students: true } } } } } } },
    });

    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const wallet   = agent.wallet ?? { balance: 0 };
    const schools  = agent.tenants.length;
    const students = agent.tenants.reduce((s, at) => s + (at.tenant._count?.students ?? 0), 0);

    // This month commission
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthTxs = await prisma.agentTransaction.findMany({
      where: {
        walletId:  wallet.id,
        type:      "COMMISSION",
        createdAt: { gte: startOfMonth },
      },
    });
    const thisMonthCommission = monthTxs.reduce((s, t) => s + t.amount, 0);

    // Lifetime commission
    const allTxs = await prisma.agentTransaction.findMany({
      where: { walletId: wallet.id, type: "COMMISSION" },
    });
    const lifetimeCommission = allTxs.reduce((s, t) => s + t.amount, 0);

    return res.json({
      success: true,
      data: {
        balance:          wallet.balance,
        schools,
        students,
        thisMonthCommission,
        lifetimeCommission,
        commissionRate:   agent.commissionRate,
      },
    });
  } catch (err) {
    console.error("[getDashboard]", err);
    return res.status(500).json({ error: "Failed to get dashboard." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT WALLET — GET BALANCE
// GET /api/agents/wallet/balance
// Auth: AGENT (own)
// ═══════════════════════════════════════════════════════════════════
export const getAgentBalance = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const agent  = await prisma.agent.findUnique({ where: { userId } });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const wallet = await getOrCreateAgentWallet(agent.id);

    return res.json({ success: true, data: { balance: wallet.balance, currency: "KES" } });
  } catch (err) {
    console.error("[getAgentBalance]", err);
    return res.status(500).json({ error: "Failed to get balance." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT WALLET — TOP UP (SYSTEM_ADMIN only — credits commission)
// POST /api/agents/wallet/topup
// Auth: SYSTEM_ADMIN
// Body: { agentId, amount, description? }
// ═══════════════════════════════════════════════════════════════════
export const topUpAgentWallet = async (req, res) => {
  try {
    if (!assertSystemAdmin(req, res)) return;

    const { agentId, amount, description = "Manual top-up by system admin" } = req.body;
    if (!agentId || !amount) return res.status(400).json({ error: "agentId and amount required." });

    const agent = await prisma.agent.findUnique({ where: { id: Number(agentId) } });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const wallet = await creditAgentWallet(agent.id, Number(amount), description);
    return res.json({ success: true, data: { balance: wallet.balance } });
  } catch (err) {
    console.error("[topUpAgentWallet]", err);
    return res.status(500).json({ error: "Failed to top up agent wallet." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT WALLET — WITHDRAWAL REQUEST
// POST /api/agents/wallet/withdraw
// Auth: AGENT (own)
// Body: { amount, method, accountDetails }
// ═══════════════════════════════════════════════════════════════════
export const withdrawAgentWallet = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role   = req.user?.role;
    if (role !== "AGENT") return res.status(403).json({ error: "Forbidden." });

    const agent = await prisma.agent.findUnique({ where: { userId } });
    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Valid amount required." });

    const wallet = await deductAgentWallet(
      agent.id,
      Number(amount),
      "WITHDRAWAL",
      `Withdrawal request by agent ${agent.id}`
    );

    return res.json({
      success: true,
      message:  "Withdrawal recorded. Processing will be done within 24 hours.",
      data:     { balance: wallet.balance },
    });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    console.error("[withdrawAgentWallet]", err);
    return res.status(500).json({ error: "Withdrawal failed." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AGENT WALLET — TRANSACTION HISTORY
// GET /api/agents/wallet/transactions
// Auth: AGENT (own) or SYSTEM_ADMIN
// ═══════════════════════════════════════════════════════════════════
export const getAgentTransactions = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role   = req.user?.role;

    let agent;
    if (role === "AGENT") {
      agent = await prisma.agent.findUnique({ where: { userId } });
    } else if (role === "SYSTEM_ADMIN" || role === "ADMIN") {
      const id = req.query.agentId;
      if (!id) return res.status(400).json({ error: "agentId query param required." });
      agent = await prisma.agent.findUnique({ where: { id: Number(id) } });
    }

    if (!agent) return res.status(404).json({ error: "Agent not found." });

    const wallet = await getOrCreateAgentWallet(agent.id);
    const page   = Math.max(1, Number(req.query.page) || 1);
    const limit  = Math.min(50, Number(req.query.limit) || 20);

    const transactions = await prisma.agentTransaction.findMany({
      where:   { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
    });

    return res.json({ success: true, data: transactions, page, limit });
  } catch (err) {
    console.error("[getAgentTransactions]", err);
    return res.status(500).json({ error: "Failed to fetch transactions." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// ADMIN WALLET — GET BALANCE (tenant admin's wallet)
// GET /api/agents/admin-wallet/balance
// Auth: ADMIN (tenant-scoped)
// ═══════════════════════════════════════════════════════════════════
export const getAdminWalletBalance = async (req, res) => {
  try {
    const userId   = req.user?.userId;
    const tenantId = req.user?.tenantId;
    const role     = req.user?.role;

    if (role !== "ADMIN") return res.status(403).json({ error: "Forbidden." });

    // Admin wallet is the aggregate of all parent wallets in the tenant
    const parents = await prisma.parent.findMany({
      where:   { tenantId },
      include: { wallet: true },
    });

    const totalBalance = parents.reduce((s, p) => s + (p.wallet?.balance ?? 0), 0);
    const activeWallets = parents.filter(p => (p.wallet?.balance ?? 0) > 0).length;

    return res.json({
      success: true,
      data: {
        totalSubscribedBalance: totalBalance,
        activeWallets,
        totalParents: parents.length,
        currency: "KES",
      },
    });
  } catch (err) {
    console.error("[getAdminWalletBalance]", err);
    return res.status(500).json({ error: "Failed to get admin wallet data." });
  }
};

// ═══════════════════════════════════════════════════════════════════
// ADMIN WALLET — TRANSACTION OVERVIEW
// GET /api/agents/admin-wallet/transactions
// Auth: ADMIN (tenant-scoped)
// ═══════════════════════════════════════════════════════════════════
export const getAdminWalletTransactions = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const role     = req.user?.role;

    if (role !== "ADMIN") return res.status(403).json({ error: "Forbidden." });

    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);

    // Fetch transactions for all parents in this tenant
    const transactions = await prisma.transaction.findMany({
      where: {
        parent: { tenantId },
      },
      include: {
        parent: {
          include: { user: { select: { name: true, email: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
    });

    return res.json({ success: true, data: transactions, page, limit });
  } catch (err) {
    console.error("[getAdminWalletTransactions]", err);
    return res.status(500).json({ error: "Failed to get transactions." });
  }
};