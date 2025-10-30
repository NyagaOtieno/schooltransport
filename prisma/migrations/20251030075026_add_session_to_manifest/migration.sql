-- CreateEnum
CREATE TYPE "ManifestSession" AS ENUM ('MORNING', 'EVENING');

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "session" "ManifestSession" NOT NULL DEFAULT 'MORNING';
