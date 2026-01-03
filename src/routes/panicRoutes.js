// src/routes/panicRoutes.js
import express from "express";
import { triggerPanic } from "../controllers/panicController.js"; // ✅ named import
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();
router.post("/panic", authMiddleware, triggerPanic);

export default router;
