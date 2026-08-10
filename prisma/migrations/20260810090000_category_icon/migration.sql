-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "iconAssetId" TEXT;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

