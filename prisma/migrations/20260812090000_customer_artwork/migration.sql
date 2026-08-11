-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "uploadedById" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "artworkMaxFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "artworkRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "cart_item_files" (
    "cartItemId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_item_files_pkey" PRIMARY KEY ("cartItemId","assetId")
);

-- CreateTable
CREATE TABLE "quote_basket_item_files" (
    "basketItemId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_basket_item_files_pkey" PRIMARY KEY ("basketItemId","assetId")
);

-- CreateTable
CREATE TABLE "order_item_files" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "assetId" TEXT,
    "fileName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_item_files" (
    "id" TEXT NOT NULL,
    "quoteItemId" TEXT NOT NULL,
    "assetId" TEXT,
    "fileName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_request_item_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_item_files_assetId_idx" ON "cart_item_files"("assetId");

-- CreateIndex
CREATE INDEX "quote_basket_item_files_assetId_idx" ON "quote_basket_item_files"("assetId");

-- CreateIndex
CREATE INDEX "order_item_files_orderItemId_idx" ON "order_item_files"("orderItemId");

-- CreateIndex
CREATE INDEX "quote_request_item_files_quoteItemId_idx" ON "quote_request_item_files"("quoteItemId");

-- CreateIndex
CREATE INDEX "assets_uploadedById_idx" ON "assets"("uploadedById");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_files" ADD CONSTRAINT "cart_item_files_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_files" ADD CONSTRAINT "cart_item_files_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_basket_item_files" ADD CONSTRAINT "quote_basket_item_files_basketItemId_fkey" FOREIGN KEY ("basketItemId") REFERENCES "quote_basket_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_basket_item_files" ADD CONSTRAINT "quote_basket_item_files_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_files" ADD CONSTRAINT "order_item_files_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_files" ADD CONSTRAINT "order_item_files_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_item_files" ADD CONSTRAINT "quote_request_item_files_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "quote_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_item_files" ADD CONSTRAINT "quote_request_item_files_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

