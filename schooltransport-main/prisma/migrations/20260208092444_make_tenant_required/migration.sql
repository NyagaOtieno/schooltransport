/*
  Warnings:

  - Made the column `tenantId` on table `Asset` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Bus` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Client` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `PanicEvent` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Parent` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Student` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- ===============================
-- BACKFILL tenantId (REQUIRED STEP)
-- ===============================

UPDATE "User"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

UPDATE "Parent"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

UPDATE "Student"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

UPDATE "Bus"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

UPDATE "Asset"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

UPDATE "PanicEvent"
SET "tenantId" = 1
WHERE "tenantId" IS NULL;

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Bus" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PanicEvent" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Parent" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Student" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
