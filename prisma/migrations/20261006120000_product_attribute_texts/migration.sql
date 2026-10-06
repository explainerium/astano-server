-- Attribute values typed for one product alone.
--
-- The client, 6 October: "Abmessungen" — 600 products, nearly every one with
-- its own size. As list values each would be saved for every other product's
-- dropdown. These two tables hold it as text on the product instead.
--
-- Purely additive: one column with a default, two new tables, nothing dropped
-- or rewritten. product_attributes is untouched, so the code running before
-- this deploy keeps working against the migrated database.

-- AlterTable
ALTER TABLE "attributes" ADD COLUMN "freeText" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_attribute_texts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_attribute_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_text_translations" (
    "id" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_attribute_text_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_attribute_texts_attributeId_idx" ON "product_attribute_texts"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_texts_productId_attributeId_key" ON "product_attribute_texts"("productId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_text_translations_textId_locale_key" ON "product_attribute_text_translations"("textId", "locale");

-- AddForeignKey
ALTER TABLE "product_attribute_texts" ADD CONSTRAINT "product_attribute_texts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_texts" ADD CONSTRAINT "product_attribute_texts_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_text_translations" ADD CONSTRAINT "product_attribute_text_translations_textId_fkey" FOREIGN KEY ("textId") REFERENCES "product_attribute_texts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
