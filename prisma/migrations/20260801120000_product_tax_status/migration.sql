-- WooCommerce's "Tax status", which the model was missing: only the tax *class*
-- existed, and that decides the rate, not whether tax applies at all.
--
-- Kept separate from the class deliberately. Folding "not taxed" into a
-- zero-rate class would lose a real distinction — a zero-rated supply is still
-- taxable and the invoice has to be able to explain why, which is exactly what
-- the reverse-charge line depends on (R10).

CREATE TYPE "TaxStatus" AS ENUM ('TAXABLE', 'SHIPPING_ONLY', 'NONE');

-- Existing products keep today's behaviour: everything was taxed before this
-- column existed, so TAXABLE is the only backfill that changes nothing.
ALTER TABLE "products"
  ADD COLUMN "taxStatus" "TaxStatus" NOT NULL DEFAULT 'TAXABLE';
