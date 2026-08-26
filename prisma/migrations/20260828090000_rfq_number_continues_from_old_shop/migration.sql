-- Enquiry numbering continues the old shop rather than restarting.
--
-- The client asked for RFQ numbering to start at 1025, the same reasoning as
-- the order numbers: the old site's quote plugin has already issued everything
-- below it, and two different enquiries wearing one number is a conversation
-- nobody can follow a year later.
--
-- setval rather than RESTART, and floored by the highest number already stored,
-- so this can never wind the sequence backwards onto rows that exist. On a
-- fresh database MAX is null and the floor of 1024 applies; on one that has
-- already passed 1025 nothing moves.
SELECT setval(
	'public.quote_requests_number_seq',
	GREATEST(1024, (SELECT COALESCE(MAX("number"), 0) FROM "quote_requests")),
	true
);
