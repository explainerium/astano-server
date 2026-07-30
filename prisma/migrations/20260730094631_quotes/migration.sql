-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'ANSWERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteAuthor" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateTable
CREATE TABLE "quote_baskets" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_baskets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_basket_items" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_basket_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "userId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactCompany" TEXT,
    "accessTokenHash" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "expiresAt" TIMESTAMP(3),
    "quotedSubtotal" DECIMAL(12,4),
    "quotedCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "convertedOrderId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attributes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" INTEGER NOT NULL,
    "moqAtSubmission" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "quotedUnitPrice" DECIMAL(12,4),
    "quotedLineTotal" DECIMAL(12,4),

    CONSTRAINT "quote_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_messages" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "author" "QuoteAuthor" NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_baskets_token_key" ON "quote_baskets"("token");

-- CreateIndex
CREATE INDEX "quote_baskets_userId_idx" ON "quote_baskets"("userId");

-- CreateIndex
CREATE INDEX "quote_basket_items_basketId_idx" ON "quote_basket_items"("basketId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_basket_items_basketId_variantId_key" ON "quote_basket_items"("basketId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_number_key" ON "quote_requests"("number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_accessTokenHash_key" ON "quote_requests"("accessTokenHash");

-- CreateIndex
CREATE INDEX "quote_requests_userId_idx" ON "quote_requests"("userId");

-- CreateIndex
CREATE INDEX "quote_requests_status_idx" ON "quote_requests"("status");

-- CreateIndex
CREATE INDEX "quote_requests_submittedAt_idx" ON "quote_requests"("submittedAt");

-- CreateIndex
CREATE INDEX "quote_request_items_quoteId_idx" ON "quote_request_items"("quoteId");

-- CreateIndex
CREATE INDEX "quote_messages_quoteId_idx" ON "quote_messages"("quoteId");

-- AddForeignKey
ALTER TABLE "quote_baskets" ADD CONSTRAINT "quote_baskets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_basket_items" ADD CONSTRAINT "quote_basket_items_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "quote_baskets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_basket_items" ADD CONSTRAINT "quote_basket_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_items" ADD CONSTRAINT "quote_request_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_items" ADD CONSTRAINT "quote_request_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
