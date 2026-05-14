// src/routes/agent.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  bootstrapSystemAdmin,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  createSchool,
  getMySchools,
  getDashboard,
  getAgentBalance,
  topUpAgentWallet,
  withdrawAgentWallet,
  getAgentTransactions,
  getAdminWalletBalance,
  getAdminWalletTransactions,
} from "../controllers/agent.controller.js";

const router = express.Router();

// ── Public (no JWT needed — protected by SYSTEM_ADMIN_SECRET) ──────
router.post("/bootstrap-system-admin", bootstrapSystemAdmin);

// ── All routes below require valid JWT ─────────────────────────────
router.use(authMiddleware);

// ── Specific named routes BEFORE /:id to avoid conflicts ───────────
router.post("/create-school",            createSchool);
router.get("/my-schools",                getMySchools);
router.get("/dashboard",                 getDashboard);

// ── Agent wallet (specific paths before /:id) ──────────────────────
router.get("/wallet/balance",            getAgentBalance);
router.post("/wallet/topup",             topUpAgentWallet);
router.post("/wallet/withdraw",          withdrawAgentWallet);
router.get("/wallet/transactions",       getAgentTransactions);

// ── Admin wallet overview ──────────────────────────────────────────
router.get("/admin-wallet/balance",      getAdminWalletBalance);
router.get("/admin-wallet/transactions", getAdminWalletTransactions);

// ── Collection routes ──────────────────────────────────────────────
router.get("/",    listAgents);   // GET  /api/agents
router.post("/",   createAgent);  // POST /api/agents

// ── Dynamic :id routes LAST to avoid swallowing named routes ───────
router.get("/:id",    getAgent);
router.put("/:id",    updateAgent);
router.delete("/:id", deleteAgent);

export default router;