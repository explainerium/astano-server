-- Options that follow the main quantity, and options in the inquiry basket.
--
-- Client, 22 September: some options must be ordered in exactly the main
-- product's quantity (an engraving per cutter), and customers typed other
-- numbers that cannot be quoted. `followsMainQuantity` is the per-option switch
-- in the product editor. Default false, so every existing option behaves
-- exactly as it did until somebody ticks it.
--
-- The same message showed that an inquiry product's options never reached the
-- inquiry basket: the basket had no way to hold an option line. It gets the
-- cart's parent link, and a submitted request keeps it.
--
-- Additive only. No row is changed, no column or row is removed.
ALTER TABLE "product_options"
	ADD COLUMN "followsMainQuantity" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quote_basket_items"
	ADD COLUMN "parentItemId" TEXT;

CREATE INDEX "quote_basket_items_parentItemId_idx" ON "quote_basket_items"("parentItemId");

ALTER TABLE "quote_basket_items"
	ADD CONSTRAINT "quote_basket_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "quote_basket_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_request_items"
	ADD COLUMN "parentItemId" TEXT;

CREATE INDEX "quote_request_items_parentItemId_idx" ON "quote_request_items"("parentItemId");

ALTER TABLE "quote_request_items"
	ADD CONSTRAINT "quote_request_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "quote_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
