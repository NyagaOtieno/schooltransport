// src/routes/Wallet.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  topUp,
  balance,
  transactions,       // ✅ now exported from controller (see Wallet.controller.js)
} from "../controllers/Wallet.controller.js";  // ✅ fixed casing: was wallet.controller.js

const router = express.Router();

// All wallet endpoints require a valid JWT
router.use(authMiddleware);

/**
 * POST /api/wallet/topup
 * Body: { amount: number }
 * Role: PARENT or CLIENT
 */
router.post("/topup", topUp);

/**
 * GET /api/wallet/balance
 * Role: PARENT or CLIENT
 */
router.get("/balance", balance);

/**
 * GET /api/wallet/transactions
 * Role: PARENT or CLIENT
 * Query: ?page=1&limit=20
 */
router.get("/transactions", transactions);

export default router;