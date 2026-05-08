/*
  Warnings:

  - A unique constraint covering the columns `[schoolId,plateNumber]` on the table `Bus` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Bus_plateNumber_key";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedByUserId" INTEGER,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredByUserId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Bus_schoolId_plateNumber_key" ON "Bus"("schoolId", "plateNumber");
