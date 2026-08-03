-- The unique index on (taxClassId, countryCode, state, priority) was not
-- constraining anything in the case that actually occurs.
--
-- `state` is NULL on every rate that applies to a whole country — which is
-- almost all of them, since a region is only named for something like a US
-- state. SQL treats NULL as *unknown*, and a unique index rejects a row only
-- when its key is equal to an existing one. NULL = NULL is not true, so
-- PostgreSQL considered two identical whole-country rates to be different keys
-- and let both in. The index guarded the rare case and ignored the common one.
--
-- That is not cosmetic. resolveTax() applies *every* matching rate and sums
-- them, which is right for genuinely stacked taxes (a state rate plus a county
-- rate) and catastrophic for a duplicate: three had already accumulated here,
-- and a EUR 100 order to Germany was being taxed 19% twice — EUR 38.00.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+; this database is 18.1) makes NULL behave
-- like an ordinary value for uniqueness, so the index finally means what it
-- reads as. Prisma cannot express this in schema.prisma, which is why this
-- migration is hand-written. The @@unique attribute stays on the model so the
-- generated client still knows the key exists — only the NULL semantics differ.
--
-- The duplicate rows were removed before this ran; the index cannot be built
-- while any remain.

DROP INDEX "tax_rates_taxClassId_countryCode_state_priority_key";

CREATE UNIQUE INDEX "tax_rates_taxClassId_countryCode_state_priority_key"
  ON "tax_rates" ("taxClassId", "countryCode", "state", "priority")
  NULLS NOT DISTINCT;
