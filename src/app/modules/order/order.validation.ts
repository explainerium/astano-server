import { z } from "zod"

const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")

/**
 * A single address shape for billing and shipping.
 *
 * `countryCode` is an ISO code, never a display name. The old shop replaced its
 * country select with a free-text field holding labels like "Deutschland", and
 * both tax and shipping resolution broke as a result.
 */
const address = z.object({
	firstName: z.string().trim().min(1).max(100),
	lastName: z.string().trim().min(1).max(100),
	company: z.string().trim().max(200).optional(),
	street1: z.string().trim().min(1).max(200),
	street2: z.string().trim().max(200).optional(),
	city: z.string().trim().min(1).max(120),
	state: z.string().trim().max(120).optional(),
	postcode: z.string().trim().min(1).max(30),
	countryCode,
	phone: z.string().trim().max(50).optional(),
	email: z.string().trim().toLowerCase().email().optional(),
})

/**
 * The billing address doubles as the contact for the order.
 *
 * Company, phone and email are required on it at the client's request: these
 * are made-to-order goods, most of them for businesses, and a drawing that
 * needs a question asked about it is worthless if nobody can be reached. The
 * shipping address keeps them optional — a delivery address is a place, not a
 * person, and asking for the same phone number twice is how a checkout loses
 * people.
 */
const billingAddress = address.extend({
	company: z.string().trim().min(1, "Company is required").max(200),
	phone: z.string().trim().min(1, "Phone is required").max(50),
	email: z.string().trim().toLowerCase().email(),
})

const checkoutBody = z.object({
	billingAddress,
	/// Omitted means "ship to the billing address".
	shippingAddress: address.optional(),
	shippingMethodId: z.string().uuid().optional(),
	paymentMethodId: z.string().uuid().optional(),
	customerNote: z.string().trim().max(2000).optional(),
	vatNumber: z.string().trim().max(40).optional(),
})

/** Totals without placing anything — what the checkout page shows. */
export const previewSchema = z.object({ body: checkoutBody.partial({ billingAddress: true }) })

export const placeOrderSchema = z.object({
	body: checkoutBody.extend({
		shippingMethodId: z.string().uuid("Choose a delivery method"),
		paymentMethodId: z.string().uuid("Choose a payment method"),
	}),
})

export const listOrdersSchema = z.object({
	query: z.object({
		status: z
			.enum(["PENDING", "PROCESSING", "ON_HOLD", "COMPLETED", "CANCELLED", "REFUNDED", "FAILED"])
			.optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const addNoteSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		body: z.string().trim().min(1, "Write something").max(4000),
		/**
		 * Defaults to private. A note that emails the customer by accident cannot
		 * be recalled, so the safe value is the one you get by not choosing.
		 */
		isCustomerVisible: z.boolean().default(false),
	}),
})

export const updateStatusSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		status: z.enum([
			"PENDING",
			"PROCESSING",
			"ON_HOLD",
			"COMPLETED",
			"CANCELLED",
			"REFUNDED",
			"FAILED",
		]),
		paymentStatus: z
			.enum(["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"])
			.optional(),
		note: z.string().trim().max(1000).optional(),
	}),
})

/**
 * The whole set on a line, not an addition — the same shape the cart uses.
 *
 * A customer who attached the wrong drawing has to be able to take it off, and
 * an add-only endpoint leaves that to a second endpoint nobody builds. The
 * product's own limit is enforced in the service; 20 here only bounds what the
 * parser will accept.
 */
export const setItemFilesSchema = z.object({
	params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
	body: z.object({ assetIds: z.array(z.string().uuid()).max(20).default([]) }),
})

export const OrderValidation = {
	previewSchema,
	placeOrderSchema,
	listOrdersSchema,
	idSchema,
	updateStatusSchema,
	addNoteSchema,
	setItemFilesSchema,
}
