-- ============================================================
-- Migration: Add Agent System
-- Run this against your Railway PostgreSQL database.
-- After running, redeploy the backend so Prisma picks up the
-- new schema (no npx prisma migrate needed on Railway —
-- just ensure DATABASE_URL is set and restart the service).
-- ============================================================

-- 1. Add new enum values (safe on Postgres — ADD VALUE is non-transactional)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AGENT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SYSTEM_ADMIN';

-- 2. Create AgentTxType enum
DO $$ BEGIN
  CREATE TYPE "AgentTxType" AS ENUM ('COMMISSION', 'WITHDRAWAL', 'TOPUP', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Make User.tenantId nullable (AGENT/SYSTEM_ADMIN users have no tenant)
ALTER TABLE "User" ALTER COLUMN "tenantId" DROP NOT NULL;

-- 4. Create Agent model
CREATE TABLE IF NOT EXISTS "Agent" (
  "id"             SERIAL PRIMARY KEY,
  "userId"         INTEGER NOT NULL UNIQUE,
  "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5. Create AgentWallet
CREATE TABLE IF NOT EXISTS "AgentWallet" (
  "id"        SERIAL PRIMARY KEY,
  "agentId"   INTEGER NOT NULL UNIQUE,
  "balance"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentWallet_agentId_fkey" FOREIGN KEY ("agentId")
    REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 6. Create AgentTransaction
CREATE TABLE IF NOT EXISTS "AgentTransaction" (
  "id"            SERIAL PRIMARY KEY,
  "walletId"      INTEGER NOT NULL,
  "type"          "AgentTxType" NOT NULL,
  "amount"        DOUBLE PRECISION NOT NULL,
  "reference"     TEXT UNIQUE,
  "description"   TEXT,
  "balanceBefore" DOUBLE PRECISION NOT NULL,
  "balanceAfter"  DOUBLE PRECISION NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentTransaction_walletId_fkey" FOREIGN KEY ("walletId")
    REFERENCES "AgentWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 7. Create AgentTenant (agent ↔ school linking table)
CREATE TABLE IF NOT EXISTS "AgentTenant" (
  "id"          SERIAL PRIMARY KEY,
  "agentId"     INTEGER NOT NULL,
  "tenantId"    INTEGER NOT NULL,
  "onboardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentTenant_agentId_fkey" FOREIGN KEY ("agentId")
    REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentTenant_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentTenant_agentId_tenantId_key" UNIQUE ("agentId", "tenantId")
);

-- 8. Indexes
CREATE INDEX IF NOT EXISTS "Agent_userId_idx"           ON "Agent"("userId");
CREATE INDEX IF NOT EXISTS "AgentWallet_agentId_idx"    ON "AgentWallet"("agentId");
CREATE INDEX IF NOT EXISTS "AgentTransaction_walletId_idx" ON "AgentTransaction"("walletId");
CREATE INDEX IF NOT EXISTS "AgentTransaction_type_idx"  ON "AgentTransaction"("type");
CREATE INDEX IF NOT EXISTS "AgentTransaction_createdAt_idx" ON "AgentTransaction"("createdAt");
CREATE INDEX IF NOT EXISTS "AgentTenant_agentId_idx"    ON "AgentTenant"("agentId");
CREATE INDEX IF NOT EXISTS "AgentTenant_tenantId_idx"   ON "AgentTenant"("tenantId");

-- ============================================================
-- DONE. Restart your Railway backend service after running this.
-- ============================================================