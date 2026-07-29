/*
  Warnings:

  - You are about to drop the column `legacyWpId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `passwordFormat` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "users_legacyWpId_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "legacyWpId",
DROP COLUMN "passwordFormat";

-- DropEnum
DROP TYPE "PasswordFormat";
