-- CreateTable
CREATE TABLE "category_price_tiers" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "role" "PriceRole" NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "type" "TierType" NOT NULL DEFAULT 'FIXED_PRICE',
    "value" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_price_tiers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "minQuantity" INTEGER NOT NULL,
    "type" "TierType" NOT NULL DEFAULT 'FIXED_PRICE',
    "value" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_price_tiers_categoryId_role_idx" ON "category_price_tiers"("categoryId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "category_price_tiers_categoryId_role_minQuantity_key" ON "category_price_tiers"("categoryId", "role", "minQuantity");

-- CreateIndex
CREATE INDEX "customer_price_tiers_userId_productId_idx" ON "customer_price_tiers"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_price_tiers_userId_productId_minQuantity_key" ON "customer_price_tiers"("userId", "productId", "minQuantity");

-- AddForeignKey
ALTER TABLE "category_price_tiers" ADD CONSTRAINT "category_price_tiers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_price_tiers" ADD CONSTRAINT "customer_price_tiers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_price_tiers" ADD CONSTRAINT "customer_price_tiers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
