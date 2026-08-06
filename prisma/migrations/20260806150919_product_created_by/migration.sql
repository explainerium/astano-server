-- AlterTable
ALTER TABLE "products" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "products_createdById_idx" ON "products"("createdById");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
