// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import "./cron.js";
import app from "./src/app.js";
import prisma from "./src/middleware/prisma.js";

console.log("🔥 SERVER ENTRY FILE LOADED");

const PORT = process.env.PORT || 5000;




// Helper: Retry Prisma connection
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

// Graceful shutdown
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

// Start the server
const startServer = async () => {
  try {
    await connectPrisma();

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    process.on("uncaughtException", (err) => {
      console.error("❌ Uncaught Exception:", err);
      shutdown(server, 1);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("❌ Unhandled Rejection:", reason);
      shutdown(server, 1);
    });

    process.on("SIGINT", () => shutdown(server));
    process.on("SIGTERM", () => shutdown(server));
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
