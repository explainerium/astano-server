-- Move "used for variations" from the attribute to the product↔attribute link.
--
-- WooCommerce stores this per product, in `_product_attributes.is_variation`,
-- not on the global attribute — the same attribute can split one product into
-- versions while being plain information on another. astano's own `pa_material`
-- is `is_variation: 1` on one product, which the previous global flag could not
-- express.

-- 1. The new per-product flag.
ALTER TABLE "product_attributes" ADD COLUMN "isVariation" BOOLEAN NOT NULL DEFAULT false;

-- 2. Carry the old intent across before dropping it. Every product already
--    using an attribute that was marked a variant axis keeps that behaviour,
--    so no existing product silently changes shape.
UPDATE "product_attributes" pa
SET "isVariation" = true
FROM "attributes" a
WHERE pa."attributeId" = a."id"
  AND a."isVariantAxis" = true;

-- 3. Drop the global flag.
ALTER TABLE "attributes" DROP COLUMN "isVariantAxis";
