import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import schoolRoutes from "./routes/schoolRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import assistantRoutes from "./routes/assistantRoutes.js";
import manifestRoutes from "./routes/manifestRoutes.js";
import trackingRoutes from "./routes/trackingRoutes.js"; // ✅ Added live tracking route
import panicRoutes from "./routes/panicRoutes.js";

dotenv.config();

const app = express();
// -----------------------------
// 🔐 CORS – MUST BE FIRST
// -----------------------------
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://trackmykid-webapp.vercel.app");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});


app.set("trust proxy", 1);

// -----------------------------
// Middleware
// -----------------------------
app.use(cors({
  origin: [
    "https://trackmykid-webapp.vercel.app",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// -----------------------------
// Debug logger for all incoming requests
// -----------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------
// Mount routes
// -----------------------------
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/parents", parentRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/assistants", assistantRoutes);
app.use("/api/manifests", manifestRoutes);
app.use("/api/tracking", trackingRoutes); // ✅ New tracking route
app.use("/api/panic", panicRoutes);

// -----------------------------
// Health check route (for Railway)
// -----------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API is running 🚀" });
});

// -----------------------------
// Catch-all 404 route
// -----------------------------
app.use((req, res, next) => {
  console.warn(`⚠️ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "Route not found" });
});

// -----------------------------
// Global error handler
// -----------------------------
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

export default app;
