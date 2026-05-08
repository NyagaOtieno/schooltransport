// src/routes/wallet.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { topUp, balance, transactions } from "../controllers/wallet.controller.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/topup",        topUp);         // POST /api/wallet/topup
router.get("/balance",       balance);        // GET  /api/wallet/balance
router.get("/transactions",  transactions);   // GET  /api/wallet/transactions

export default router;