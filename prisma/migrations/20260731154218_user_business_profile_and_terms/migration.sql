-- AlterTable
ALTER TABLE "users" ADD COLUMN     "foundingDate" TIMESTAMP(3),
ADD COLUMN     "psiMember" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salutation" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);
