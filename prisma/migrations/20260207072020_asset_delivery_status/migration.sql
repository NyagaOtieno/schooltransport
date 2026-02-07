/*
  Warnings:

  - You are about to drop the column `confirmedByUserId` on the `Asset` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AssetDeliveryStatus" AS ENUM ('IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PanicStatus" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "confirmedByUserId",
ADD COLUMN     "confirmedById" INTEGER,
ADD COLUMN     "deliveryStatus" "AssetDeliveryStatus" NOT NULL DEFAULT 'IN_TRANSIT';

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
