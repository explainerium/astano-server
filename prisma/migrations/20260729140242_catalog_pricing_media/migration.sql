-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PRODUCT', 'OPTION');

-- CreateEnum
CREATE TYPE "AssetVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PriceRole" AS ENUM ('GUEST', 'B2C', 'RESELLER');

-- CreateEnum
CREATE TYPE "TierType" AS ENUM ('FIXED_PRICE', 'PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isOptionCategory" BOOLEAN NOT NULL DEFAULT false,
    "imageAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translations" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'PRODUCT',
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "moq" INTEGER NOT NULL DEFAULT 0,
    "featuredAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "product_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "moq" INTEGER,
    "manageStock" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
    "weightKg" DECIMAL(10,3),
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isVariantAxis" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_translations" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "attribute_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_values" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_value_translations" (
    "id" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "attribute_value_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("productId","attributeId","attributeValueId")
);

-- CreateTable
CREATE TABLE "variant_attribute_values" (
    "variantId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,

    CONSTRAINT "variant_attribute_values_pkey" PRIMARY KEY ("variantId","attributeValueId")
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_translations" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "bundle_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "preselected" BOOLEAN NOT NULL DEFAULT false,
    "discountPercent" DECIMAL(5,2),

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_folders" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "AssetVisibility" NOT NULL DEFAULT 'PUBLIC',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "originalName" TEXT NOT NULL,
    "derivatives" JSONB,
    "folderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_translations" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "alt" TEXT,
    "caption" TEXT,

    CONSTRAINT "asset_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_assets" (
    "productId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_assets_pkey" PRIMARY KEY ("productId","assetId")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" "PriceRole" NOT NULL,
    "basePrice" DECIMAL(12,4) NOT NULL,
    "salePrice" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_tiers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" "PriceRole" NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "type" "TierType" NOT NULL DEFAULT 'FIXED_PRICE',
    "value" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_prices" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "role" "PriceRole" NOT NULL,
    "basePrice" DECIMAL(12,4) NOT NULL,
    "salePrice" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_price_tiers" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "role" "PriceRole" NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "type" "TierType" NOT NULL DEFAULT 'FIXED_PRICE',
    "value" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "categories_isHidden_idx" ON "categories"("isHidden");

-- CreateIndex
CREATE UNIQUE INDEX "category_translations_categoryId_locale_key" ON "category_translations"("categoryId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "category_translations_locale_slug_key" ON "category_translations"("locale", "slug");

-- CreateIndex
CREATE INDEX "products_status_kind_idx" ON "products"("status", "kind");

-- CreateIndex
CREATE INDEX "products_quoteEnabled_idx" ON "products"("quoteEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_productId_locale_key" ON "product_translations"("productId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_locale_slug_key" ON "product_translations"("locale", "slug");

-- CreateIndex
CREATE INDEX "product_categories_categoryId_idx" ON "product_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_code_key" ON "attributes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_translations_attributeId_locale_key" ON "attribute_translations"("attributeId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_values_attributeId_code_key" ON "attribute_values"("attributeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_translations_attributeValueId_locale_key" ON "attribute_value_translations"("attributeValueId", "locale");

-- CreateIndex
CREATE INDEX "product_attributes_attributeId_idx" ON "product_attributes"("attributeId");

-- CreateIndex
CREATE INDEX "variant_attribute_values_attributeValueId_idx" ON "variant_attribute_values"("attributeValueId");

-- CreateIndex
CREATE INDEX "bundles_productId_idx" ON "bundles"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_translations_bundleId_locale_key" ON "bundle_translations"("bundleId", "locale");

-- CreateIndex
CREATE INDEX "bundle_items_productId_idx" ON "bundle_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundleId_productId_key" ON "bundle_items"("bundleId", "productId");

-- CreateIndex
CREATE INDEX "media_folders_parentId_idx" ON "media_folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storageKey_key" ON "assets"("storageKey");

-- CreateIndex
CREATE INDEX "assets_folderId_idx" ON "assets"("folderId");

-- CreateIndex
CREATE INDEX "assets_visibility_idx" ON "assets"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "asset_translations_assetId_locale_key" ON "asset_translations"("assetId", "locale");

-- CreateIndex
CREATE INDEX "product_assets_assetId_idx" ON "product_assets"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_productId_role_key" ON "product_prices"("productId", "role");

-- CreateIndex
CREATE INDEX "product_price_tiers_productId_role_idx" ON "product_price_tiers"("productId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tiers_productId_role_minQuantity_key" ON "product_price_tiers"("productId", "role", "minQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "variant_prices_variantId_role_key" ON "variant_prices"("variantId", "role");

-- CreateIndex
CREATE INDEX "variant_price_tiers_variantId_role_idx" ON "variant_price_tiers"("variantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "variant_price_tiers_variantId_role_minQuantity_key" ON "variant_price_tiers"("variantId", "role", "minQuantity");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_featuredAssetId_fkey" FOREIGN KEY ("featuredAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_translations" ADD CONSTRAINT "attribute_translations_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_value_translations" ADD CONSTRAINT "attribute_value_translations_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_translations" ADD CONSTRAINT "bundle_translations_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_translations" ADD CONSTRAINT "asset_translations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_tiers" ADD CONSTRAINT "product_price_tiers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_price_tiers" ADD CONSTRAINT "variant_price_tiers_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
