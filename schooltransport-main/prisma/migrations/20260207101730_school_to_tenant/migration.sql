-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Bus" DROP CONSTRAINT "Bus_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "BusLocation" DROP CONSTRAINT "BusLocation_busId_fkey";

-- DropForeignKey
ALTER TABLE "Manifest" DROP CONSTRAINT "Manifest_busId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_parentId_fkey";

-- DropForeignKey
ALTER TABLE "PanicEvent" DROP CONSTRAINT "PanicEvent_childId_fkey";

-- DropForeignKey
ALTER TABLE "PanicEvent" DROP CONSTRAINT "PanicEvent_userId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_busId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bus" ADD CONSTRAINT "Bus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusLocation" ADD CONSTRAINT "BusLocation_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
