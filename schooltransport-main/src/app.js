// -----------------------------
// Load environment
// -----------------------------
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

// -----------------------------
// Core imports
// -----------------------------
import prisma from "./middleware/prisma.js";

// -----------------------------
// Routes
// -----------------------------
import smsRoutes from "./routes/sms.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import manifestRoutes from "./routes/manifestRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import panicRoutes from "./routes/panicRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import assetRoutes from "./routes/assetRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import schoolRoutes from "./routes/schoolRoutes.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import { startBillingCron } from "./jobs/billing.cron.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import trackingRoutes from "./routes/trackingRoutes.js";
import walletRoutes from "./routes/wallet.routes.js";
import agentRoutes from "./routes/agentRoutes.js";

startBillingCron();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// -----------------------------
// Logger FIRST (fix)
// -----------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------
// CORS
// -----------------------------
const allowlist = (process.env.CORS_ORIGINS ||
  "https://trackmykid-webapp.vercel.app,http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.options("*", cors());

// -----------------------------
// API Routes
// -----------------------------
app.use("/api/sms", smsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/manifests", manifestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/panic", panicRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/users", userRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/parents", parentRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/agents", agentRoutes);

// -----------------------------
// Health check
// -----------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API running 🚀" });
});

// -----------------------------
// 404 handler
// -----------------------------
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

export default app;