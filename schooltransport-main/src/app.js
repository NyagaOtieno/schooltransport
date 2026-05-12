// -----------------------------
// Load environment first
// -----------------------------
import dotenv from "dotenv";
dotenv.config();

// -----------------------------
// Core dependencies
// -----------------------------
import express from "express";
import cors from "cors";

// -----------------------------
// Prisma
// -----------------------------
import prisma from "./middleware/prisma.js";

// -----------------------------
// Route imports
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

// NEW
import trackingRoutes from "./routes/trackingRoutes.js";
import walletRoutes from "./routes/wallet.routes.js";

// -----------------------------
// App init
// -----------------------------
const app = express();
const PORT = process.env.PORT || 5000;

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json());

// -----------------------------
// Request logger
// MUST come BEFORE routes
// -----------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// -----------------------------
// CORS
// -----------------------------
const allowlist = (
  process.env.CORS_ORIGINS ||
  "https://trackmykid-webapp.vercel.app,http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      if (allowlist.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

// -----------------------------
// Health route
// -----------------------------
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      success: true,
      message: "API is running 🚀",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// -----------------------------
// API routes
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

// NEW
app.use("/api/tracking", trackingRoutes);
app.use("/api/wallet", walletRoutes);

// -----------------------------
// 404 handler
// -----------------------------
app.use((req, res) => {
  console.warn(`404 → ${req.method} ${req.originalUrl}`);

  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// -----------------------------
// Global error handler
// -----------------------------
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR]", err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

export default app;