/*
  Warnings:

  - You are about to drop the column `parentId` on the `Asset` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `Asset` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `Bus` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `School` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tenantId,plateNumber]` on the table `Bus` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email,tenantId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone,tenantId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'CLIENT';
ALTER TYPE "Role" ADD VALUE 'MERCHANT';

-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Bus" DROP CONSTRAINT "Bus_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "PanicEvent" DROP CONSTRAINT "PanicEvent_childId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_schoolId_fkey";

-- DropIndex
DROP INDEX "Bus_schoolId_plateNumber_key";

-- DropIndex
DROP INDEX "User_email_schoolId_key";

-- DropIndex
DROP INDEX "User_phone_schoolId_key";

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "parentId",
DROP COLUMN "schoolId",
ADD COLUMN     "clientId" INTEGER,
ADD COLUMN     "tenantId" INTEGER;

-- AlterTable
ALTER TABLE "Bus" DROP COLUMN "schoolId",
ADD COLUMN     "tenantId" INTEGER;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "clientId" INTEGER,
ALTER COLUMN "parentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PanicEvent" ADD COLUMN     "assetId" INTEGER,
ADD COLUMN     "tenantId" INTEGER,
ALTER COLUMN "childId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN     "tenantId" INTEGER;

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "schoolId",
ADD COLUMN     "tenantId" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "schoolId",
ADD COLUMN     "tenantId" INTEGER;

-- DropTable
DROP TABLE "School";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "mode" "AppMode" NOT NULL DEFAULT 'KID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Bus_tenantId_plateNumber_key" ON "Bus"("tenantId", "plateNumber");

-- CreateIndex
CREATE INDEX "PanicEvent_assetId_idx" ON "PanicEvent"("assetId");

-- CreateIndex
CREATE INDEX "PanicEvent_tenantId_idx" ON "PanicEvent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_tenantId_key" ON "User"("email", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_tenantId_key" ON "User"("phone", "tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bus" ADD CONSTRAINT "Bus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
