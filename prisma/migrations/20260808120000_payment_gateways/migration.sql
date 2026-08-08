-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('STRIPE', 'PAYPAL');

-- CreateEnum
CREATE TYPE "PaymentGatewayMode" AS ENUM ('TEST', 'LIVE');

-- AlterEnum
ALTER TYPE "PaymentMethodType" ADD VALUE 'GATEWAY';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "paymentProvider" "PaymentGatewayProvider",
ADD COLUMN     "paymentReference" TEXT;

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "gatewayId" TEXT;

-- CreateTable
CREATE TABLE "payment_gateways" (
    "id" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "mode" "PaymentGatewayMode" NOT NULL DEFAULT 'TEST',
    "testCredentials" JSONB,
    "liveCredentials" JSONB,
    "enabledMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "testedAt" TIMESTAMP(3),
    "testedMode" "PaymentGatewayMode",
    "testSucceeded" BOOLEAN,
    "testMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateways_provider_key" ON "payment_gateways"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_eventId_key" ON "payment_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paymentReference_key" ON "orders"("paymentReference");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "payment_gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;

