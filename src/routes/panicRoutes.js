// src/routes/panicRoutes.js
import express from "express";
import { triggerPanic } from "../controllers/panicController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// ✅ WORKING: because app mounts "/api/panic", this becomes POST /api/panic
router.post("/", authMiddleware, triggerPanic);

export default router;
