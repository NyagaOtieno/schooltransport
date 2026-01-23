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
import trackingRoutes from "./routes/trackingRoutes.js";
import panicRoutes from "./routes/panicRoutes.js";

dotenv.config();

const app = express();

// -----------------------------
// Allowed origins
// -----------------------------
const allowedOrigins = [
  "http://localhost:3000",                 // local dev
  "http://127.0.0.1:3000",                // localhost alternative
  "http://localhost:5173",                 // Vite dev server
  "https://trackmykid-webapp.vercel.app"  // production frontend
];

// -----------------------------
// 🔐 CORS middleware
// -----------------------------
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow Postman / curl / mobile apps
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

// -----------------------------
// Handle OPTIONS preflight globally
// -----------------------------
app.options("*", cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true
}));

// -----------------------------
// Body parsers
// -----------------------------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// -----------------------------
// Debug logger
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
app.use("/api/tracking", trackingRoutes);
app.use("/api/panic", panicRoutes);

// -----------------------------
// Health check
// -----------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API is running 🚀" });
});

// -----------------------------
// 404 handler
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

