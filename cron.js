import cron from "node-cron";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Example cron job: runs every 5 minutes
cron.schedule("*/1 * * * *", async () => {
  console.log("🕒 Cron job running:", new Date());

  try {
    // Example task: update lastUpdate timestamp for all buses
    const buses = await prisma.bus.findMany();
    for (const bus of buses) {
      await prisma.bus.update({
        where: { id: bus.id },
        data: {
          updatedAt: new Date(),
        },
      });
    }
    console.log(`✅ Updated ${buses.length} buses' timestamps`);
  } catch (error) {
    console.error("❌ Cron job failed:", error);
  }
});
