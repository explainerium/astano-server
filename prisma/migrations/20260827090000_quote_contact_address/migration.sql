-- The enquiry form asks for an address and a split name.
--
-- A quote is a commercial offer, and what it costs to make and ship depends on
-- where it is going — the client was asking for that by email after every
-- enquiry. House number is its own column at their request: German addresses
-- are read that way.
--
-- `contactName` stays and stays authoritative. Everything that reads a name
-- reads it, and it is composed from the two new ones on the way in, so an
-- enquiry submitted before this still reads correctly.
ALTER TABLE "quote_requests" ADD COLUMN "contactSalutation" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactFirstName" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactLastName" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactStreet" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactHouseNumber" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactPostcode" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactCity" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN "contactCountryCode" TEXT;
