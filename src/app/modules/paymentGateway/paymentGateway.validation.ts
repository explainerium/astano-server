import { z } from "zod"

const provider = z.enum(["STRIPE", "PAYPAL"])
const mode = z.enum(["TEST", "LIVE"])

export const providerParamSchema = z.object({
	params: z.object({ provider }),
})

/**
 * A field that is absent means "leave it alone"; `null` means "clear it".
 *
 * The distinction matters because the screen cannot show what is stored — an
 * empty box is the normal state of a saved secret, so treating empty as "delete"
 * would wipe a working key every time somebody edited the field beside it.
 */
export const saveCredentialsSchema = z.object({
	params: z.object({ provider }),
	body: z.object({
		mode,
		credentials: z.record(z.string(), z.string().max(500).nullable()),
	}),
})

export const testConnectionSchema = z.object({
	params: z.object({ provider }),
	body: z.object({ mode }),
})

export const updateSettingsSchema = z.object({
	params: z.object({ provider }),
	body: z
		.object({
			isActive: z.boolean().optional(),
			mode: mode.optional(),
			enabledMethods: z.array(z.string().max(40)).max(20).optional(),
		})
		.refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" }),
})

export const PaymentGatewayValidation = {
	providerParamSchema,
	saveCredentialsSchema,
	testConnectionSchema,
	updateSettingsSchema,
}
