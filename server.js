// -----------------------------
// Load environment + dependencies
// -----------------------------
import dotenv from "dotenv";
dotenv.config(); // Load .env first

// Run any scheduled jobs (cron)
import "./cron.js";

// Core imports
import app from "./src/app.js";
import prisma from "./src/middleware/prisma.js";

// -----------------------------
// Import notification & manifest routes
// -----------------------------
import smsRoutes from "./src/routes/sms.routes.js";
import notificationRoutes from "./src/routes/notification.routes.js";
import manifestRoutes from "./src/routes/manifestRoutes.js";
import cors from "cors";
import authRoutes from "./src/routes/auth.routes.js";

const PORT = process.env.PORT || 5000;

// -----------------------------
// Register main routes
// -----------------------------
app.use("/api/sms", smsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/manifests", manifestRoutes);
app.use("/api/auth", authRoutes); 


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

// -----------------------------
// Helper: Retry Prisma connection
// -----------------------------
const connectPrisma = async (retries = 5, delay = 2000) => {
  for (let i = 1; i <= retries; i++) {
    try {
      await prisma.$connect();
      console.log("✅ Prisma connected successfully");
      return;
    } catch (err) {
      console.error(`⚠️ Prisma connection attempt ${i} failed:`, err.message);
      if (i === retries) throw err;
      console.log(`⏳ Retrying in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

// -----------------------------
// Graceful shutdown function
// -----------------------------
const shutdown = async (server, exitCode = 0) => {
  console.log("🛑 Shutting down server...");
  if (server) {
    server.close(() => console.log("🛑 HTTP server closed"));
  }

  try {
    await prisma.$disconnect();
    console.log("🛑 Prisma Client disconnected");
  } catch (err) {
    console.error("❌ Error disconnecting Prisma:", err);
  }

  process.exit(exitCode);
};

// -----------------------------
// Start the server
// -----------------------------
const startServer = async () => {
  try {
    await connectPrisma();

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Handle unexpected errors
    process.on("uncaughtException", (err) => {
      console.error("❌ Uncaught Exception:", err);
      shutdown(server, 1);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("❌ Unhandled Rejection:", reason);
      shutdown(server, 1);
    });

    // Graceful shutdown on SIGINT / SIGTERM
    process.on("SIGINT", () => shutdown(server));
    process.on("SIGTERM", () => shutdown(server));
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
