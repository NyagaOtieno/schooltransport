/*
  Warnings:

  - Added the required column `childId` to the `PanicEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdBy` to the `PanicEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `latitude` to the `PanicEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `longitude` to the `PanicEvent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AppMode" AS ENUM ('KID', 'ASSET');

-- DropForeignKey
ALTER TABLE "Manifest" DROP CONSTRAINT "Manifest_studentId_fkey";

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "assetId" INTEGER,
ALTER COLUMN "studentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PanicEvent" ADD COLUMN     "childId" INTEGER NOT NULL,
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "mode" "AppMode" NOT NULL DEFAULT 'KID';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetOtp" TEXT,
ADD COLUMN     "resetOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "resetOtpSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "tag" TEXT,
    "busId" INTEGER,
    "parentId" INTEGER,
    "schoolId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Manifest_studentId_idx" ON "Manifest"("studentId");

-- CreateIndex
CREATE INDEX "Manifest_assetId_idx" ON "Manifest"("assetId");

-- CreateIndex
CREATE INDEX "PanicEvent_childId_idx" ON "PanicEvent"("childId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
