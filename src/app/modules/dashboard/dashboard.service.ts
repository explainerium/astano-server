import type { OrderStatus } from "@prisma/client"
import { prisma } from "../../../shared/prisma"

/**
 * Everything the admin landing screen shows, in one request.
 *
 * One endpoint rather than eight: the page draws all of it at once, and eight
 * round trips to fill one screen is eight chances for it to appear in pieces.
 */

/**
 * Statuses that are not money.
 *
 * Revenue counts every order we still expect to be paid for, not only the ones
 * already settled — astano sells on bank transfer, so a real order sits at
 * PENDING/UNPAID for days and excluding it would make the figure meaningless.
 * What is excluded is what will never arrive.
 */
const NOT_REVENUE: OrderStatus[] = ["CANCELLED", "FAILED", "REFUNDED"]

const DAY_MS = 24 * 60 * 60 * 1000

interface Window {
	from: Date
	to: Date
}

/**
 * The window asked for, and the equally long one immediately before it.
 *
 * Comparing like with like is the whole point of the delta — a 7-day figure
 * against the 7 days before it, never against a calendar week of a different
 * length.
 */
const windowsFor = (days: number, now: Date): { current: Window; previous: Window } => {
	const from = new Date(now.getTime() - days * DAY_MS)
	return {
		current: { from, to: now },
		previous: { from: new Date(from.getTime() - days * DAY_MS), to: from },
	}
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Null rather than 0 or 100: growing from no orders at all is not "+100%", it
 * is a number that cannot be expressed as a ratio, and printing one anyway is
 * how dashboards start lying.
 */
const deltaPercent = (current: number, previous: number): number | null => {
	if (previous === 0) return null
	return Number((((current - previous) / previous) * 100).toFixed(2))
}

/** YYYY-MM-DD in UTC — the series is bucketed by day, not by hour. */
const dayKey = (date: Date): string => date.toISOString().slice(0, 10)

const orderTotals = async (window: Window) => {
	const result = await prisma.order.aggregate({
		where: {
			placedAt: { gte: window.from, lt: window.to },
			status: { notIn: NOT_REVENUE },
		},
		_sum: { grandTotal: true },
		_count: { _all: true },
	})

	return {
		revenue: result._sum.grandTotal ?? null,
		orders: result._count._all,
	}
}

const quoteCount = (window: Window) =>
	prisma.quoteRequest.count({
		where: { submittedAt: { gte: window.from, lt: window.to } },
	})

/**
 * Revenue, orders and quote requests per day across the window.
 *
 * Bucketed in JavaScript rather than in SQL: Prisma cannot group by a truncated
 * date without dropping to raw SQL, and raw SQL would tie this module to the
 * table names. The window is days, not years, so the row count is small.
 *
 * Every day in the range is emitted, including the empty ones — a chart that
 * silently skips quiet days draws a straight line through them and makes the
 * business look busier than it was.
 *
 * Orders and quotes share the series so the two charts drawn from it always
 * agree on their x-axis; nothing is worse than a dashboard whose panels
 * disagree about what "last Tuesday" means.
 */
const dailySeries = async (window: Window, days: number) => {
	const [orders, quotes] = await Promise.all([
		prisma.order.findMany({
			where: {
				placedAt: { gte: window.from, lt: window.to },
				status: { notIn: NOT_REVENUE },
			},
			select: { placedAt: true, grandTotal: true },
		}),
		prisma.quoteRequest.findMany({
			where: { submittedAt: { gte: window.from, lt: window.to } },
			select: { submittedAt: true },
		}),
	])

	const buckets = new Map<string, { revenue: number; orders: number; quotes: number }>()
	for (let index = 0; index < days; index += 1) {
		const day = new Date(window.from.getTime() + index * DAY_MS)
		buckets.set(dayKey(day), { revenue: 0, orders: 0, quotes: 0 })
	}

	for (const order of orders) {
		const bucket = buckets.get(dayKey(order.placedAt))
		if (!bucket) continue
		bucket.revenue += Number(order.grandTotal)
		bucket.orders += 1
	}

	for (const quote of quotes) {
		const bucket = buckets.get(dayKey(quote.submittedAt))
		if (bucket) bucket.quotes += 1
	}

	return [...buckets.entries()].map(([date, bucket]) => ({
		date,
		revenue: bucket.revenue.toFixed(2),
		orders: bucket.orders,
		quotes: bucket.quotes,
	}))
}

/**
 * How the window's orders are distributed across the status board.
 *
 * Deliberately counts *every* status, cancellations included — this is the one
 * panel where the failures are the point. A rising CANCELLED slice is exactly
 * what a shop owner needs to see, and it would be invisible if this reused the
 * revenue filter.
 */
const ordersByStatus = async (window: Window) => {
	const rows = await prisma.order.groupBy({
		by: ["status"],
		where: { placedAt: { gte: window.from, lt: window.to } },
		_count: { _all: true },
	})

	return rows
		.map((row) => ({ status: row.status, count: row._count._all }))
		.sort((a, b) => b.count - a.count)
}

/**
 * Revenue split by who bought — the number this business is actually run on.
 *
 * astano sells retail and wholesale from the same catalogue, so "is the trade
 * side growing?" is the question the dashboard exists to answer. An order with
 * no account is a guest checkout; otherwise the buyer's role decides.
 *
 * The role is read live rather than frozen on the order, so a customer approved
 * as a dealer last week moves their whole history into the dealer column. That
 * is the right answer for "who are my customers", and the wrong one for a
 * historical audit — this panel is the former.
 */
const revenueByCustomerType = async (window: Window) => {
	const orders = await prisma.order.findMany({
		where: {
			placedAt: { gte: window.from, lt: window.to },
			status: { notIn: NOT_REVENUE },
		},
		select: { grandTotal: true, user: { select: { role: true } } },
	})

	const totals = new Map<string, { revenue: number; orders: number }>()
	for (const order of orders) {
		// Staff orders are rare but real (test purchases, phone orders keyed in
		// by an admin); lumping them into B2C would quietly inflate retail.
		const type = order.user?.role ?? "GUEST"
		const existing = totals.get(type) ?? { revenue: 0, orders: 0 }
		existing.revenue += Number(order.grandTotal)
		existing.orders += 1
		totals.set(type, existing)
	}

	return [...totals.entries()]
		.map(([type, row]) => ({ type, revenue: row.revenue.toFixed(2), orders: row.orders }))
		.sort((a, b) => Number(b.revenue) - Number(a.revenue))
}

/** Picks the requested language, falling back to whatever the row does have. */
const nameIn = (translations: { locale: string; name: string }[], locale: string) =>
	(translations.find((row) => row.locale === locale) ?? translations[0])?.name ?? "—"

/**
 * What sold over the window, by product and by category, from one pass.
 *
 * Order lines carry a productId but no category — categories can be
 * reorganised, and an order must not change shape when they are. So the lines
 * are rolled up by product first and the current category attached afterwards:
 * the money is historical, the grouping is current.
 *
 * A product in two categories contributes its full line total to both. That is
 * the honest answer to "which categories are selling"; it does mean the
 * category figures do not sum to total revenue, which is why they are drawn as
 * a ranking and never as a share of a whole.
 *
 * Both rankings come from the same groupBy because they are the same money
 * counted at two depths — running them separately would be a second query for
 * an answer already in hand, and a chance for the two panels to disagree.
 */
const salesRollup = async (window: Window, locale: string) => {
	const lines = await prisma.orderItem.groupBy({
		by: ["productId"],
		where: {
			productId: { not: null },
			order: {
				placedAt: { gte: window.from, lt: window.to },
				status: { notIn: NOT_REVENUE },
			},
		},
		_sum: { lineTotal: true, quantity: true },
	})

	if (!lines.length) return { topProducts: [], topCategories: [] }

	const products = await prisma.product.findMany({
		where: { id: { in: lines.map((line) => line.productId as string) } },
		select: {
			id: true,
			translations: { select: { locale: true, name: true } },
			categories: {
				select: {
					category: {
						select: {
							id: true,
							translations: { select: { locale: true, name: true } },
						},
					},
				},
			},
		},
	})

	const byProduct = new Map(products.map((product) => [product.id, product]))
	const categoryTotals = new Map<
		string,
		{ id: string; name: string; revenue: number; quantity: number }
	>()
	const productTotals: { id: string; name: string; revenue: number; quantity: number }[] = []

	for (const line of lines) {
		const product = byProduct.get(line.productId as string)
		if (!product) continue

		const revenue = Number(line._sum.lineTotal ?? 0)
		const quantity = line._sum.quantity ?? 0

		productTotals.push({
			id: product.id,
			name: nameIn(product.translations, locale),
			revenue,
			quantity,
		})

		for (const link of product.categories) {
			const existing = categoryTotals.get(link.category.id) ?? {
				id: link.category.id,
				name: nameIn(link.category.translations, locale),
				revenue: 0,
				quantity: 0,
			}
			existing.revenue += revenue
			existing.quantity += quantity
			categoryTotals.set(link.category.id, existing)
		}
	}

	const rank = (rows: { revenue: number; quantity: number; id: string; name: string }[]) =>
		rows
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 5)
			.map((row) => ({ ...row, revenue: row.revenue.toFixed(2) }))

	return { topProducts: rank(productTotals), topCategories: rank([...categoryTotals.values()]) }
}

const recentOrders = async () => {
	const rows = await prisma.order.findMany({
		orderBy: { placedAt: "desc" },
		take: 8,
		select: {
			id: true,
			number: true,
			status: true,
			paymentStatus: true,
			grandTotal: true,
			currency: true,
			placedAt: true,
			user: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
			addresses: {
				where: { type: "BILLING" },
				take: 1,
				select: { firstName: true, lastName: true, company: true },
			},
		},
	})

	return rows.map((row) => {
		// The account is the better name when there is one, but a guest checkout
		// has no account — the billing address is then the only name we hold.
		// A trade customer is known by their company, a retail one by their name.
		const address = row.addresses[0]
		const named =
			row.user?.company || [row.user?.firstName, row.user?.lastName].filter(Boolean).join(" ")
		const fallback =
			address?.company || [address?.firstName, address?.lastName].filter(Boolean).join(" ")

		return {
			id: row.id,
			number: row.number,
			status: row.status,
			paymentStatus: row.paymentStatus,
			grandTotal: row.grandTotal.toFixed(2),
			currency: row.currency,
			placedAt: row.placedAt,
			customer: named || fallback || row.user?.email || null,
		}
	})
}

/**
 * The dealer review queue.
 *
 * Keyed off the *user's* status, not a field on the application: the decision
 * lives on the User because that is what decides whether wholesale prices
 * apply, and duplicating it here would be a second source of truth for money.
 */
const pendingDealers = async () => {
	const rows = await prisma.b2bApplication.findMany({
		where: { user: { status: "PENDING" } },
		orderBy: { createdAt: "asc" },
		take: 6,
		select: {
			id: true,
			userId: true,
			companyName: true,
			city: true,
			countryCode: true,
			createdAt: true,
			firstName: true,
			lastName: true,
			user: { select: { email: true } },
		},
	})

	return rows.map((row) => ({
		id: row.id,
		userId: row.userId,
		companyName: row.companyName,
		city: row.city,
		countryCode: row.countryCode,
		createdAt: row.createdAt,
		contact: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.user.email,
		email: row.user.email,
	}))
}

const summary = async ({ days, locale }: { days: number; locale: string }) => {
	const now = new Date()
	const { current, previous } = windowsFor(days, now)

	/*
	 * Three waves rather than one Promise.all over everything.
	 *
	 * The screen needs more than a dozen queries, and the database is behind a
	 * connection pooler — firing them all at once would have a single dashboard
	 * load reach for most of the pool, and two admins opening it together could
	 * starve the shop itself. Grouped like this the page still assembles in
	 * three round trips instead of thirteen, with a bounded number in flight.
	 */
	const [currentTotals, previousTotals, currentQuotes, previousQuotes] = await Promise.all([
		orderTotals(current),
		orderTotals(previous),
		quoteCount(current),
		quoteCount(previous),
	])

	const [productTotal, productPublished, series, statusBreakdown] = await Promise.all([
		prisma.product.count(),
		prisma.product.count({ where: { status: "PUBLISHED" } }),
		dailySeries(current, days),
		ordersByStatus(current),
	])

	const [sales, customerTypes, orders, dealers, pendingDealerCount] = await Promise.all([
		salesRollup(current, locale),
		revenueByCustomerType(current),
		recentOrders(),
		pendingDealers(),
		prisma.user.count({ where: { role: "RESELLER", status: "PENDING" } }),
	])

	const revenue = Number(currentTotals.revenue ?? 0)
	const previousRevenue = Number(previousTotals.revenue ?? 0)

	return {
		period: { days, from: current.from, to: current.to },
		stats: {
			revenue: {
				value: revenue.toFixed(2),
				previous: previousRevenue.toFixed(2),
				deltaPercent: deltaPercent(revenue, previousRevenue),
			},
			orders: {
				value: currentTotals.orders,
				previous: previousTotals.orders,
				deltaPercent: deltaPercent(currentTotals.orders, previousTotals.orders),
			},
			quotes: {
				value: currentQuotes,
				previous: previousQuotes,
				deltaPercent: deltaPercent(currentQuotes, previousQuotes),
			},
			products: { value: productTotal, published: productPublished },
		},
		series,
		topProducts: sales.topProducts,
		topCategories: sales.topCategories,
		ordersByStatus: statusBreakdown,
		revenueByCustomerType: customerTypes,
		recentOrders: orders,
		pendingDealers: dealers,
		pendingDealerCount,
	}
}

export const DashboardService = { summary }
