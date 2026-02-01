
// -----------------------------
// Load environment + dependencies
// -----------------------------
import express from "express";
import dotenv from "dotenv";
dotenv.config(); // Load .env first


// Core imports

import prisma from "./middleware/prisma.js";


// -----------------------------
// Import notification & manifest routes
// -----------------------------
import smsRoutes from "./routes/sms.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import manifestRoutes from "./routes/manifestRoutes.js";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import panicRoutes from "./routes/panicRoutes.js";


const PORT = process.env.PORT || 5000;

const app = express();
app.use(express.json());


// -----------------------------
// ✅ CORS (ALLOWLIST) — ADD THIS
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

// -----------------------------
// Register main routes
// -----------------------------
app.use("/api/sms", smsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/manifests", manifestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/panic", panicRoutes);
app.use("/api/students",studentRoutes);



// -----------------------------
// Middleware: Log all incoming requests
// -----------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------
// Health check route (important for Railway / Render / Docker)
// -----------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API is running 🚀" });
});

// -----------------------------
// Catch-all route for unknown endpoints
// -----------------------------
app.use((req, res) => {
  console.warn(`⚠️ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "Route not found" });
});



export default app;

