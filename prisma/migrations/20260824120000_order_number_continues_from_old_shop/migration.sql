-- Order numbering continues the old WooCommerce shop rather than restarting.
--
-- The live site's last order was 817, so the first order placed here is 818.
-- Restarting at 1 would issue numbers that already exist in the client's
-- accounting: two different orders, two different invoices, one number. That is
-- the kind of thing discovered by an accountant a year later.
--
-- setval rather than RESTART, and guarded by the highest number already stored,
-- so this can never wind the sequence backwards onto rows that exist. On a
-- fresh database MAX is null and the floor of 817 applies; on one that has
-- already passed 818 nothing moves.
SELECT setval(
	'public.orders_number_seq',
	GREATEST(817, (SELECT COALESCE(MAX("number"), 0) FROM "orders")),
	true
);
