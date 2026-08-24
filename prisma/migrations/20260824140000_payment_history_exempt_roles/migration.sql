-- Roles that skip the order-history requirement on a payment method.
--
-- Payment by invoice is offered to approved resellers from their first order
-- and to everyone else from their second. One `minCompletedOrders` cannot say
-- both, and a second invoice row would appear twice at checkout.
--
-- Empty by default, which is the existing behaviour exactly: no role is exempt
-- and `minCompletedOrders` applies to everybody.
ALTER TABLE "payment_methods"
	ADD COLUMN "historyExemptRoles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
