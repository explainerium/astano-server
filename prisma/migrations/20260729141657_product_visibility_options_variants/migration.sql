/*
  Warnings:

  - You are about to drop the `bundle_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `bundle_translations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `bundles` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('SHOP_AND_SEARCH', 'SHOP_ONLY', 'SEARCH_ONLY', 'HIDDEN');

-- DropForeignKey
ALTER TABLE "bundle_items" DROP CONSTRAINT "bundle_items_bundleId_fkey";

-- DropForeignKey
ALTER TABLE "bundle_items" DROP CONSTRAINT "bundle_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "bundle_translations" DROP CONSTRAINT "bundle_translations_bundleId_fkey";

-- DropForeignKey
ALTER TABLE "bundles" DROP CONSTRAINT "bundles_productId_fkey";

-- AlterTable
ALTER TABLE "product_prices" ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "saleStartsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "imageAssetId" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lowStockThreshold" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibility" "ProductVisibility" NOT NULL DEFAULT 'SHOP_AND_SEARCH';

-- AlterTable
ALTER TABLE "variant_prices" ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "saleStartsAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "bundle_items";

-- DropTable
DROP TABLE "bundle_translations";

-- DropTable
DROP TABLE "bundles";

-- CreateTable
CREATE TABLE "variant_translations" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "variant_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionProductId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "groupLabel" TEXT,
    "preselected" BOOLEAN NOT NULL DEFAULT false,
    "discountPercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "variant_translations_variantId_locale_key" ON "variant_translations"("variantId", "locale");

-- CreateIndex
CREATE INDEX "product_options_optionProductId_idx" ON "product_options"("optionProductId");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_productId_optionProductId_key" ON "product_options"("productId", "optionProductId");

-- CreateIndex
CREATE INDEX "product_variants_isActive_idx" ON "product_variants"("isActive");

-- CreateIndex
CREATE INDEX "products_visibility_status_idx" ON "products"("visibility", "status");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_translations" ADD CONSTRAINT "variant_translations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_optionProductId_fkey" FOREIGN KEY ("optionProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
