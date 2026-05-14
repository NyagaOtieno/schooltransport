import express from "express";
import { bootstrapAdmin, bootstrapAgent } from "../controllers/bootstrap.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// public (first run only)
router.post("/admin", bootstrapAdmin);

// protected
router.post("/agent", authMiddleware, bootstrapAgent);

export default router;