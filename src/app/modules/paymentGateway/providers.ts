import type { PaymentGatewayProvider } from "@prisma/client"

/**
 * What each provider needs, described as data.
 *
 * The admin screen renders itself from this — fields, labels, and the line of
 * help telling the client exactly where in Stripe's own dashboard the value
 * lives. Adding PayPal is a new entry here plus an adapter, not a new form.
 *
 * The help text is the part that matters. "Secret key" means nothing to someone
 * who has just signed up; "Developers → API keys, the one starting sk_" means
 * they can go and get it.
 */

export interface CredentialField {
	key: string
	label: string
	/** False for values designed to be public, like a publishable key. */
	secret: boolean
	required: boolean
	placeholder: string
	/** Where to find it, in the provider's own words. */
	help: string
}

export interface ProviderMethod {
	/** The provider's own identifier, sent to their API verbatim. */
	code: string
	label: string
	/** Whether the customer leaves the site for this method's own flow. */
	redirects: boolean
	description: string
}

export interface ProviderDefinition {
	provider: PaymentGatewayProvider
	label: string
	/** Where the client signs up and finds their keys. */
	dashboardUrl: string
	fields: CredentialField[]
	methods: ProviderMethod[]
	/** Appended to the API's base URL to give the client their webhook endpoint. */
	webhookPath: string
}

export const PROVIDERS: Record<PaymentGatewayProvider, ProviderDefinition> = {
	STRIPE: {
		provider: "STRIPE",
		label: "Stripe",
		dashboardUrl: "https://dashboard.stripe.com/apikeys",
		fields: [
			{
				key: "publishableKey",
				label: "Publishable key",
				// Designed to be read by the browser — Stripe prints it in their own
				// docs. Stored encrypted anyway, because a rule with an exception is
				// a rule somebody eventually gets wrong.
				secret: false,
				required: true,
				placeholder: "pk_test_…",
				help: "Stripe → Developers → API keys. The one that starts pk_.",
			},
			{
				key: "secretKey",
				label: "Secret key",
				secret: true,
				required: true,
				placeholder: "sk_test_…",
				help: "Same page, the one that starts sk_. Reveal it, copy it, and never share it by email.",
			},
			{
				key: "webhookSecret",
				label: "Webhook signing secret",
				secret: true,
				// Not required to save, because it does not exist until the client has
				// created the endpoint — and they need the URL from this screen first.
				required: false,
				placeholder: "whsec_…",
				help: "Create an endpoint with the URL above at Stripe → Developers → Webhooks, then copy its signing secret here.",
			},
		],
		methods: [
			{
				code: "card",
				label: "Card",
				redirects: false,
				description: "Visa, Mastercard, Amex. The fields appear on the checkout page.",
			},
			{
				code: "sepa_debit",
				label: "SEPA Lastschrift",
				redirects: false,
				description: "Direct debit. Common for German trade customers.",
			},
			{
				code: "klarna",
				label: "Klarna",
				redirects: true,
				description: "Buy now, pay later. The customer completes it on Klarna's own page.",
			},
			{
				code: "giropay",
				label: "giropay",
				redirects: true,
				description: "German online banking. Completed at the customer's own bank.",
			},
			{
				code: "paypal",
				label: "PayPal via Stripe",
				redirects: true,
				description:
					"Stripe's own PayPal integration. Leave this off if you connect PayPal directly instead — two routes to the same wallet only confuses the checkout.",
			},
		],
		webhookPath: "/api/v1/payments/webhook/stripe",
	},

	PAYPAL: {
		provider: "PAYPAL",
		label: "PayPal",
		dashboardUrl: "https://developer.paypal.com/dashboard/applications",
		fields: [
			{
				key: "clientId",
				label: "Client ID",
				secret: false,
				required: true,
				placeholder: "A…",
				help: "PayPal Developer Dashboard → Apps & Credentials → your app.",
			},
			{
				key: "clientSecret",
				label: "Secret",
				secret: true,
				required: true,
				placeholder: "E…",
				help: "Same app, under Secret. Generate one if there is none.",
			},
			{
				key: "webhookId",
				label: "Webhook ID",
				secret: false,
				required: false,
				placeholder: "WH-…",
				help: "Add a webhook with the URL above on the same page, then copy the ID it gives you.",
			},
		],
		methods: [
			{
				code: "paypal",
				label: "PayPal",
				redirects: true,
				description: "The customer approves the payment on PayPal and comes back.",
			},
		],
		webhookPath: "/api/v1/payments/webhook/paypal",
	},
}

/** Methods a gateway falls back to when the admin has enabled nothing. */
export const defaultMethods = (provider: PaymentGatewayProvider): string[] => [
	PROVIDERS[provider].methods[0]!.code,
]
