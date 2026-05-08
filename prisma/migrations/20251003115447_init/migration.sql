/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `Parent` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Parent_phone_key" ON "Parent"("phone");
