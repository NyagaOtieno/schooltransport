-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "clientId" INTEGER,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "clientId" INTEGER,
    "studentId" INTEGER,
    "assetId" INTEGER,
    "type" "SubscriptionType" NOT NULL DEFAULT 'DAILY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "clientId" INTEGER,
    "walletId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'SUCCESS',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_parentId_key" ON "Wallet"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_clientId_key" ON "Wallet"("clientId");

-- CreateIndex
CREATE INDEX "Wallet_parentId_idx" ON "Wallet"("parentId");

-- CreateIndex
CREATE INDEX "Wallet_clientId_idx" ON "Wallet"("clientId");

-- CreateIndex
CREATE INDEX "Subscription_expiryDate_idx" ON "Subscription"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_parentId_studentId_key" ON "Subscription"("parentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_clientId_assetId_key" ON "Subscription"("clientId", "assetId");

-- CreateIndex
CREATE INDEX "Transaction_parentId_idx" ON "Transaction"("parentId");

-- CreateIndex
CREATE INDEX "Transaction_clientId_idx" ON "Transaction"("clientId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");

-- CreateIndex
CREATE INDEX "Asset_tenantId_idx" ON "Asset"("tenantId");

-- CreateIndex
CREATE INDEX "Asset_busId_idx" ON "Asset"("busId");

-- CreateIndex
CREATE INDEX "Asset_clientId_idx" ON "Asset"("clientId");

-- CreateIndex
CREATE INDEX "Bus_tenantId_idx" ON "Bus"("tenantId");

-- CreateIndex
CREATE INDEX "BusLocation_busId_lastUpdate_idx" ON "BusLocation"("busId", "lastUpdate");

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE INDEX "LiveLocation_busId_idx" ON "LiveLocation"("busId");

-- CreateIndex
CREATE INDEX "LiveLocation_lastUpdate_idx" ON "LiveLocation"("lastUpdate");

-- CreateIndex
CREATE INDEX "LiveLocation_vehicleReg_idx" ON "LiveLocation"("vehicleReg");

-- CreateIndex
CREATE INDEX "Manifest_busId_createdAt_idx" ON "Manifest"("busId", "createdAt");

-- CreateIndex
CREATE INDEX "Manifest_studentId_createdAt_idx" ON "Manifest"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_parentId_idx" ON "Notification"("parentId");

-- CreateIndex
CREATE INDEX "Notification_clientId_idx" ON "Notification"("clientId");

-- CreateIndex
CREATE INDEX "Parent_tenantId_idx" ON "Parent"("tenantId");

-- CreateIndex
CREATE INDEX "Student_tenantId_idx" ON "Student"("tenantId");

-- CreateIndex
CREATE INDEX "Student_busId_idx" ON "Student"("busId");

-- CreateIndex
CREATE INDEX "Student_parentId_idx" ON "Student"("parentId");

-- CreateIndex
CREATE INDEX "Tenant_mode_idx" ON "Tenant"("mode");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
