-- The shop picks which products lead the home page, instead of the query doing it.
--
-- The home page's "Beliebte Produkte" strip has always been the first twelve
-- published products by `sortOrder`, which nobody chose: every product carries
-- sortOrder 0, so what the customer saw first was whatever Postgres happened to
-- return. The shop had the WooCommerce pair for this — a Featured tick and a
-- menu order — and the rebuild kept only the second one.
ALTER TABLE "products"
	ADD COLUMN "isTopProduct" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "products_isTopProduct_idx" ON "products"("isTopProduct");

-- Backfilled to exactly what the home page shows today.
--
-- Without this the strip empties itself the moment this deploys, because
-- nothing is ticked yet — a blank section on the landing page, caused by a
-- migration, on a shop nobody had touched. Marking the twelve that are already
-- there means the page is identical after the deploy and the shop edits from
-- something rather than from nothing.
--
-- The ORDER BY is the one the storefront used to run, so "the first twelve"
-- means the same twelve. Runs once; later products are ticked by hand.
UPDATE "products"
SET "isTopProduct" = true
WHERE "id" IN (
	SELECT "id"
	FROM "products"
	WHERE "status" = 'PUBLISHED'
	  AND "visibility" IN ('SHOP_AND_SEARCH', 'SHOP_ONLY')
	ORDER BY "sortOrder" ASC, "createdAt" DESC
	LIMIT 12
);
