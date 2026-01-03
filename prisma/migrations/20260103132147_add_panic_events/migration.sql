-- CreateEnum
CREATE TYPE "PanicStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "PanicEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "phoneNumber" TEXT,
    "role" "Role" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" "PanicStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PanicEvent_userId_idx" ON "PanicEvent"("userId");

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
