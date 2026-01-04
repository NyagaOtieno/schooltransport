/*
  Warnings:

  - Added the required column `createdBy` to the `PanicEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "PanicStatus" ADD VALUE 'ACTIVE';

-- AlterTable
ALTER TABLE "PanicEvent" ADD COLUMN     "createdBy" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetOtp" TEXT,
ADD COLUMN     "resetOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "resetOtpSentAt" TIMESTAMP(3);
