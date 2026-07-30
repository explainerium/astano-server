-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('BANK_TRANSFER', 'INVOICE', 'CASH_ON_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "ShippingMethodType" AS ENUM ('WEIGHT_BANDED', 'FLAT_RATE', 'FREE_SHIPPING', 'PRICE_BANDED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "taxClassId" TEXT;

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL DEFAULT 'BANK_TRANSFER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedRoles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "requiresLogin" BOOLEAN NOT NULL DEFAULT false,
    "minCompletedOrders" INTEGER NOT NULL DEFAULT 0,
    "minOrderTotal" DECIMAL(12,4),
    "maxOrderTotal" DECIMAL(12,4),
    "requiresValidatedVatId" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_translations" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,

    CONSTRAINT "payment_method_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_translations" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "shipping_zone_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_countries" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    CONSTRAINT "shipping_zone_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_methods" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ShippingMethodType" NOT NULL DEFAULT 'WEIGHT_BANDED',
    "flatCost" DECIMAL(12,4),
    "freeAboveSubtotal" DECIMAL(12,4),
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_method_translations" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "shipping_method_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "minValue" DECIMAL(12,4) NOT NULL,
    "maxValue" DECIMAL(12,4),
    "cost" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_classes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_class_translations" (
    "id" TEXT NOT NULL,
    "taxClassId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tax_class_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "taxClassId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "state" TEXT,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "appliesToShipping" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "reverseChargeWithVatId" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");

-- CreateIndex
CREATE INDEX "payment_methods_isActive_idx" ON "payment_methods"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_translations_methodId_locale_key" ON "payment_method_translations"("methodId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zones_code_key" ON "shipping_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_translations_zoneId_locale_key" ON "shipping_zone_translations"("zoneId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_countries_countryCode_key" ON "shipping_zone_countries"("countryCode");

-- CreateIndex
CREATE INDEX "shipping_zone_countries_zoneId_idx" ON "shipping_zone_countries"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_methods_zoneId_code_key" ON "shipping_methods"("zoneId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_method_translations_methodId_locale_key" ON "shipping_method_translations"("methodId", "locale");

-- CreateIndex
CREATE INDEX "shipping_rates_methodId_idx" ON "shipping_rates"("methodId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_methodId_minValue_key" ON "shipping_rates"("methodId", "minValue");

-- CreateIndex
CREATE UNIQUE INDEX "tax_classes_code_key" ON "tax_classes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_class_translations_taxClassId_locale_key" ON "tax_class_translations"("taxClassId", "locale");

-- CreateIndex
CREATE INDEX "tax_rates_countryCode_idx" ON "tax_rates"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_taxClassId_countryCode_state_priority_key" ON "tax_rates"("taxClassId", "countryCode", "state", "priority");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_taxClassId_fkey" FOREIGN KEY ("taxClassId") REFERENCES "tax_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method_translations" ADD CONSTRAINT "payment_method_translations_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "payment_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_translations" ADD CONSTRAINT "shipping_zone_translations_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_countries" ADD CONSTRAINT "shipping_zone_countries_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_method_translations" ADD CONSTRAINT "shipping_method_translations_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "shipping_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "shipping_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_class_translations" ADD CONSTRAINT "tax_class_translations_taxClassId_fkey" FOREIGN KEY ("taxClassId") REFERENCES "tax_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_taxClassId_fkey" FOREIGN KEY ("taxClassId") REFERENCES "tax_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
