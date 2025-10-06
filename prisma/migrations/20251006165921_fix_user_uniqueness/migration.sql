/*
  Warnings:

  - A unique constraint covering the columns `[email,schoolId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone,schoolId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "User_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_email_schoolId_key" ON "User"("email", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_schoolId_key" ON "User"("phone", "schoolId");
