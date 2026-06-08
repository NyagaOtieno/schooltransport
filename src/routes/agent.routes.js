// src/routes/agent.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  getWallet,
  getWalletTransactions,
  getSchools,
  createSchool,
  adminCreditAgentWallet,
  getProfile,
} from "../controllers/agent.controller.js";

const router = express.Router();

// Every agent route requires a valid JWT
router.use(authMiddleware);

/* ============================================================
   PROFILE
============================================================ */
/**
 * GET /api/agents/profile
 * Role: AGENT
 */
router.get("/profile", getProfile);

/* ============================================================
   WALLET
============================================================ */
/**
 * GET /api/agents/wallet
 * Returns balance, lifetime earned, this month earned.
 * Role: AGENT
 */
router.get("/wallet", getWallet);

/**
 * GET /api/agents/wallet/transactions?page=1&limit=20
 * Full transaction history including commissions, onboarding fees, withdrawals.
 * Role: AGENT
 */
router.get("/wallet/transactions", getWalletTransactions);

/**
 * POST /api/agents/wallet/topup
 * Admin manually credits an agent wallet.
 * Role: ADMIN | SYSTEM_ADMIN
 * Body: { agentId: number, amount: number }
 */
router.post("/wallet/topup", adminCreditAgentWallet);

/* ============================================================
   SCHOOLS
============================================================ */
/**
 * GET /api/agents/schools
 * Returns all schools (tenants) onboarded by this agent.
 * Role: AGENT
 */
router.get("/schools", getSchools);

/**
 * POST /api/agents/create-school
 * Creates tenant + admin + triggers STK push for onboarding fee.
 * Role: AGENT
 * Body: {
 *   tenantName, county, adminName, adminEmail, adminPassword,
 *   phone, onboardingFee
 * }
 */
router.post("/create-school", createSchool);

export default router;