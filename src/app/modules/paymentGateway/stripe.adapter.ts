import Stripe from "stripe"

/**
 * Everything that talks to Stripe.
 *
 * Kept behind this file so the rest of the app never imports the SDK: the
 * service decides *what* should happen, this decides how Stripe is asked. PayPal
 * gets a sibling with the same shape, and the checkout will not care which one
 * it is holding.
 *
 * A client is built per call from the credentials the admin stored. No
 * module-level singleton — the key can change from the dashboard at any moment,
 * and a cached client would keep using the old one until a redeploy.
 */

const client = (secretKey: string): Stripe =>
	new Stripe(secretKey, {
		/*
		 * Pinned to what this SDK was built against, not to the account's default.
		 *
		 * Stripe changes response shapes between versions. Letting the account's
		 * dashboard setting decide means the shop can start failing because
		 * somebody clicked "upgrade" in a browser, with nothing changed in the
		 * repository to explain it. Bumping this is a deliberate edit that goes
		 * through review with the SDK upgrade.
		 */
		apiVersion: "2026-07-29.dahlia",
		// The SDK retries idempotently on network errors; two is enough to ride out
		// a blip without making a checkout feel hung.
		maxNetworkRetries: 2,
		timeout: 20_000,
		appInfo: { name: "astano", url: "https://astano.de" },
	})

export interface ConnectionResult {
	ok: boolean
	/** Shown to the admin verbatim, so it has to read like an instruction. */
	message: string
	/** Filled in on success — proof it is the account they think it is. */
	accountName?: string
	livemode?: boolean
}

/**
 * Proves the key works, and that it is the *right kind* of key.
 *
 * `balance.retrieve` rather than something heavier: it needs a valid secret key
 * and nothing else, touches no customer data, and its response tells us whether
 * the key is live or test — which is how a live key pasted into the test slot
 * gets caught here rather than at a customer's checkout.
 */
export const testConnection = async (
	secretKey: string,
	expectLive: boolean
): Promise<ConnectionResult> => {
	if (!secretKey.startsWith("sk_") && !secretKey.startsWith("rk_")) {
		return {
			ok: false,
			message:
				"That does not look like a secret key. It should start with sk_ — pk_ is the publishable one and belongs in the field above.",
		}
	}

	try {
		const stripe = client(secretKey)
		const balance = await stripe.balance.retrieve()

		if (balance.livemode !== expectLive) {
			return {
				ok: false,
				livemode: balance.livemode,
				message: balance.livemode
					? "This is a live key, but it was entered under Test. Swap the mode, or paste the sk_test_ key instead."
					: "This is a test key, but it was entered under Live. Live payments need the sk_live_ key from the same page.",
			}
		}

		// The account's own name, so the admin can see they connected the account
		// they meant to — easy to get wrong with an agency managing several.
		let accountName: string | undefined
		try {
			const account = await stripe.accounts.retrieveCurrent()
			accountName = account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? undefined
		} catch {
			// Restricted keys may not be allowed to read the account. Not a failure
			// — the balance call already proved the key works.
		}

		return {
			ok: true,
			livemode: balance.livemode,
			accountName,
			message: accountName
				? `Connected to ${accountName}${balance.livemode ? "" : " (test mode)"}.`
				: `Connected${balance.livemode ? "" : " (test mode)"}.`,
		}
	} catch (error) {
		const stripeError = error as Stripe.errors.StripeError

		// Stripe's own message is written for developers but is usually the most
		// accurate thing available; the common cases get a plainer one.
		if (stripeError.type === "StripeAuthenticationError") {
			return {
				ok: false,
				message: "Stripe rejected this key. Check it was copied whole, with no spaces.",
			}
		}

		if (stripeError.type === "StripeConnectionError") {
			return {
				ok: false,
				message: "Could not reach Stripe. Check the connection and try again.",
			}
		}

		return { ok: false, message: stripeError.message ?? "Stripe rejected this key." }
	}
}

/**
 * Which of the enabled methods Stripe will actually offer for this payment.
 *
 * Stripe decides per payment — currency, country, amount all matter, and Klarna
 * on a €4 order simply is not available. Asking here rather than guessing means
 * the checkout never renders an option that then refuses to work.
 */
export const availableMethods = async (
	secretKey: string,
	enabled: string[]
): Promise<string[]> => {
	if (!enabled.length) return []
	// Stripe validates the list when the PaymentIntent is created; until the
	// checkout work lands, this simply passes the admin's choice through.
	return enabled
}

export { client as stripeClient }
