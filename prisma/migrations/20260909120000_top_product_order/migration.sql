-- Where each top product sits in the home page's strip, as its own decision.
--
-- The tick that chooses the twelve landed on 29 August; the order they appear
-- in was left to `sortOrder`, which the schema at the time said arranged them.
-- It cannot. `sortOrder` is a category listing's manual order and every product
-- in this catalogue carries 0, so giving a top product 1 to pull it to the
-- front of the home page would have pushed it behind all 44 products still at
-- 0 in every category it belongs to. One column cannot mean "first here" and
-- "unchanged there".
--
-- Nullable on purpose, and no backfill on purpose. Every row is NULL after
-- this runs; the storefront sorts NULLs last and then falls back to the same
-- newest-first tiebreak it uses today, so the strip is character for character
-- what it was before the deploy. The first drag in the dashboard is what puts
-- numbers in this column.
ALTER TABLE "products"
	ADD COLUMN "topProductOrder" INTEGER;
