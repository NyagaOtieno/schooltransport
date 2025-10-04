// src/middleware/prisma.js
import { PrismaClient } from "@prisma/client";

let prisma;

// Prevent multiple Prisma instances in dev (hot reload issue)
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

export default prisma;
