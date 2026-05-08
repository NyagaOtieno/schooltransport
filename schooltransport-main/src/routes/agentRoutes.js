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
} from "../controllers/agentController.js";

const router = express.Router();

// ── Public: one-time platform bootstrap ────────────────────────────
// POST /api/agents/bootstrap-system-admin
// Protected by SYSTEM_ADMIN_SECRET env var (not JWT)
router.post("/bootstrap-system-admin", bootstrapSystemAdmin);

// ── All routes below require a valid JWT ───────────────────────────
router.use(authMiddleware);

// ── Agent CRUD (SYSTEM_ADMIN / ADMIN) ──────────────────────────────
router.post("/",          createAgent);    // create agent
router.get("/",           listAgents);     // list all agents
router.get("/:id",        getAgent);       // get one agent
router.put("/:id",        updateAgent);    // update agent
router.delete("/:id",     deleteAgent);    // delete agent

// ── Agent operational endpoints ────────────────────────────────────
router.post("/create-school", createSchool);  // agent creates school + admin
router.get("/my-schools",     getMySchools);  // agent's schools
router.get("/dashboard",      getDashboard);  // agent stats

// ── Agent wallet ────────────────────────────────────────────────────
router.get("/wallet/balance",       getAgentBalance);
router.post("/wallet/topup",        topUpAgentWallet);    // SYSTEM_ADMIN credits agent
router.post("/wallet/withdraw",     withdrawAgentWallet); // agent requests withdrawal
router.get("/wallet/transactions",  getAgentTransactions);

// ── Admin wallet overview (tenant admin sees parent wallets) ────────
router.get("/admin-wallet/balance",      getAdminWalletBalance);
router.get("/admin-wallet/transactions", getAdminWalletTransactions);

export default router;