import dotenv from "dotenv";
dotenv.config(); // ✅ Load environment variables first

import app from "./src/app.js";
import prisma from "./src/middleware/prisma.js";

// Use Railway-assigned port or fallback to 5000
const PORT = process.env.PORT || 5000;

// Function to start the server
const startServer = async () => {
  try {
    // ✅ Test DB connection before starting
    await prisma.$connect();
    console.log("✅ Prisma connected successfully");

    // ✅ Bind to 0.0.0.0 so Railway (or any host) can reach it
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Handle unexpected errors in requests
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

// Graceful shutdown function
const shutdown = async (server, exitCode = 0) => {
  console.log("🛑 Shutting down server...");
  if (server) server.close(() => console.log("🛑 HTTP server closed"));

  try {
    await prisma.$disconnect();
    console.log("🛑 Prisma Client disconnected");
  } catch (err) {
    console.error("❌ Error disconnecting Prisma:", err);
  }

  process.exit(exitCode);
};

// Start the server
startServer();
