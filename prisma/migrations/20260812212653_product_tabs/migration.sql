-- CreateTable
CREATE TABLE "product_tabs" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tab_translations" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,

    CONSTRAINT "product_tab_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_tabs_productId_sortOrder_idx" ON "product_tabs"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_tab_translations_tabId_locale_key" ON "product_tab_translations"("tabId", "locale");

-- AddForeignKey
ALTER TABLE "product_tabs" ADD CONSTRAINT "product_tabs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tab_translations" ADD CONSTRAINT "product_tab_translations_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "product_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
