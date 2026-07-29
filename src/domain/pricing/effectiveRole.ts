import type { UserRole, UserStatus } from "@prisma/client"

/**
 * The role a price should be calculated against — business rule **R5b**.
 *
 * Never price against a stored role directly. A Reseller who has registered but
 * not been approved must not receive wholesale prices, and a rejected one must
 * never regain them. Getting this wrong sells at dealer rates to a stranger,
 * and it is the kind of bug that surfaces only in an invoice.
 *
 * Pure function, no I/O — see §12.2.
 */
export type PricingRole = Extract<UserRole, "GUEST" | "B2C" | "RESELLER">

export const effectiveRole = (
	role: UserRole | null | undefined,
	status: UserStatus | null | undefined
): PricingRole => {
	// Anonymous request.
	if (!role) return "GUEST"

	// Only an ACTIVE account gets anything better than guest pricing.
	if (status !== "ACTIVE") return "GUEST"

	switch (role) {
		case "RESELLER":
			return "RESELLER"
		case "B2C":
		case "SHOP_MANAGER":
		case "ADMIN":
			// Staff browse the shop at ordinary retail prices.
			return "B2C"
		case "GUEST":
		default:
			return "GUEST"
	}
}
