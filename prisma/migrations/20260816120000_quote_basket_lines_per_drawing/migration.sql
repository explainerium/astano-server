-- One line per variant was never the rule this basket runs on.
--
-- `QuoteService.addItem` has always said that a line carrying a drawing is its
-- own line — two of the same cutter shape cut to two different drawings are two
-- different things to quote, and that is most of what this shop is asked for.
-- The unique index said the opposite, so the second one failed with a
-- constraint violation the customer read as "duplicate entry", and merging a
-- guest basket into an account could not carry a second drawing across.
--
-- `cart_items` has no such index. This brings the two baskets into line.

DROP INDEX "quote_basket_items_basketId_variantId_key";

-- Kept as a plain index: the merge and the add-item lookup both search by
-- (basket, variant), and dropping the unique one would otherwise leave those
-- scanning the table.
CREATE INDEX "quote_basket_items_basketId_variantId_idx" ON "quote_basket_items"("basketId", "variantId");
