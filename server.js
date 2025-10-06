import dotenv from "dotenv";
dotenv.config(); // ✅ Load .env first!

import app from "src/app.js";
import prisma from "src/middleware/prisma.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("🛑 Prisma Client disconnected");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  console.log("🛑 Prisma Client disconnected");
  process.exit(0);
});
