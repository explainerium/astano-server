-- How many of the main product one option covers.
--
-- The client, 23 September: a single pack is one per ice cube, but a set box
-- holds four — "they want 100 sets. This is 400 ice cubes and 100 boxes."
-- `followsMainQuantity` alone could only say "the same number", so a box of
-- four had to be typed by hand and, in his words, customers "forget or type in
-- other quantities".
--
-- 1 is one for one, which is what every existing row means today, so this
-- changes nothing until somebody sets a box size. Additive only.
ALTER TABLE "product_options"
	ADD COLUMN "unitsPerOption" INTEGER NOT NULL DEFAULT 1;
