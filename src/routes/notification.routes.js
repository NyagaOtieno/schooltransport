import express from "express";
import sendNotification from "../controllers/notification.controller.js";

const router = express.Router();

// POST /api/notifications/send
router.post("/send", sendNotification);

export default router;
