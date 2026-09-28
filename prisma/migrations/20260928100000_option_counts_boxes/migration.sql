-- An option counted from the boxes rather than from the main product.
--
-- The client, 28 September: "The printing always should be same quantity as
-- the choosen boxes." 100 ice cubes in boxes of two is 50 boxes and 50 prints;
-- in boxes of four, 25 and 25. The print follows the chosen box, not the cubes.
--
-- Empty on every existing row, which means "counted from the main quantity" —
-- what every row means today. Additive only.
ALTER TABLE "product_options"
	ADD COLUMN "countsOptionProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
