// src/routes/mpesa.routes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  // STK Push (Lipa na M-Pesa Online)
  stkPush,
  stkCallback,
  stkStatus,
  // C2B (customer pays via M-Pesa menu → paybill/till)
  c2bRegister,
  c2bValidate,
  c2bConfirm,
  c2bSimulate,
  // B2C (agent withdrawals)
  b2cWithdraw,
  b2cCallback,
  b2cTimeout,
} from "../controllers/mpesa.controller.js";

const router = express.Router();

/* ============================================================
   STK PUSH — Lipa na M-Pesa Online
   Business-initiated: sends prompt to customer's phone.
============================================================ */

/**
 * POST /api/mpesa/stk-push
 * Trigger STK Push on parent/client phone.
 * Body: { phone: string, amount: number }
 * Auth: PARENT | CLIENT
 */
router.post("/stk-push", authMiddleware, stkPush);

/**
 * POST /api/mpesa/stk-callback
 * ⚠️  PUBLIC — Safaricom posts result here after user enters PIN.
 * No auth — Safaricom does not send Authorization headers.
 */
router.post("/stk-callback", stkCallback);

/**
 * GET /api/mpesa/stk-status/:checkoutRequestId
 * Frontend polls this every 3s to detect payment confirmation.
 * Auth: PARENT | CLIENT
 */
router.get("/stk-status/:checkoutRequestId", authMiddleware, stkStatus);

/* ============================================================
   C2B — Customer pays via M-Pesa menu (paybill number)
   Customer-initiated: user dials *334# or uses M-Pesa app,
   enters paybill + account ref + amount.
============================================================ */

/**
 * POST /api/mpesa/c2b/register
 * One-time call to tell Safaricom your validation + confirmation URLs.
 * Run this ONCE after deployment (or call from Railway console).
 * Auth: ADMIN | SYSTEM_ADMIN
 * Body: { responseType?: "Completed" | "Cancelled" }
 */
router.post("/c2b/register", authMiddleware, c2bRegister);

/**
 * POST /api/mpesa/c2b/validate
 * ⚠️  PUBLIC — Safaricom calls this BEFORE processing a C2B payment.
 * Return { ResultCode: 0 } to accept, non-zero to reject.
 * Only called if ResponseType = "Cancelled" during registration.
 */
router.post("/c2b/validate", c2bValidate);

/**
 * POST /api/mpesa/c2b/confirm
 * ⚠️  PUBLIC — Safaricom calls this AFTER a C2B payment succeeds.
 * Credits the correct wallet based on BillRefNumber (TRK{userId}).
 */
router.post("/c2b/confirm", c2bConfirm);

/**
 * POST /api/mpesa/c2b/simulate
 * Sandbox only — simulate a customer paying via paybill.
 * Auth: ADMIN | SYSTEM_ADMIN
 * Body: { phone: string, amount: number, billRef?: string }
 */
router.post("/c2b/simulate", authMiddleware, c2bSimulate);

/* ============================================================
   B2C — Business to Customer (agent withdrawals)
============================================================ */

/**
 * POST /api/mpesa/b2c
 * Agent requests M-Pesa withdrawal to their phone.
 * Auth: AGENT
 * Body: { phone: string, amount: number }
 */
router.post("/b2c", authMiddleware, b2cWithdraw);

/**
 * POST /api/mpesa/b2c/callback
 * ⚠️  PUBLIC — Safaricom posts B2C result here.
 */
router.post("/b2c/callback", b2cCallback);

/**
 * POST /api/mpesa/b2c/timeout
 * ⚠️  PUBLIC — Safaricom posts here if B2C times out.
 */
router.post("/b2c/timeout", b2cTimeout);

export default router;