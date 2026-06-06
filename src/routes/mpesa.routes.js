// src/routes/mpesa.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  stkPush,
  stkCallback,
  stkStatus,
  b2cWithdraw,
  b2cCallback,
  b2cTimeout,
} from "../controllers/mpesa.controller.js";

const router = express.Router();

/* ============================================================
   AUTHENTICATED ROUTES (require JWT)
============================================================ */

/**
 * POST /api/mpesa/stk-push
 * Initiate M-Pesa STK Push for wallet top-up.
 * Roles: PARENT, CLIENT
 * Body: { phone: string, amount: number }
 */
router.post("/stk-push", authMiddleware, stkPush);

/**
 * GET /api/mpesa/stk-status/:checkoutRequestId
 * Poll payment status after STK push.
 * Roles: PARENT, CLIENT
 */
router.get("/stk-status/:checkoutRequestId", authMiddleware, stkStatus);

/**
 * POST /api/mpesa/b2c
 * Agent requests M-Pesa withdrawal.
 * Roles: AGENT
 * Body: { phone: string, amount: number }
 */
router.post("/b2c", authMiddleware, b2cWithdraw);

/* ============================================================
   PUBLIC CALLBACK ROUTES
   ⚠️  These are called by Safaricom — NO auth middleware.
       Safaricom does not send Authorization headers.
       Railway URL must be publicly accessible HTTPS.
============================================================ */

/**
 * POST /api/mpesa/callback
 * Safaricom STK Push result callback.
 */
router.post("/callback", stkCallback);

/**
 * POST /api/mpesa/b2c-callback
 * Safaricom B2C result callback.
 */
router.post("/b2c-callback", b2cCallback);

/**
 * POST /api/mpesa/b2c-timeout
 * Safaricom B2C timeout callback.
 */
router.post("/b2c-timeout", b2cTimeout);

export default router;