-- Large orders on invoice: accepted with conditions, not refused.
--
-- `maxOrderTotal` can only refuse, and refusing was wrong here — the shop wants
-- an order over the threshold, it just wants to review it and agree terms
-- first. So a second, softer threshold, with the wording to go beside it.
ALTER TABLE "payment_methods"
	ADD COLUMN "conditionalAboveTotal" DECIMAL(12,4);

ALTER TABLE "payment_method_translations"
	ADD COLUMN "conditionalNotice" TEXT;
