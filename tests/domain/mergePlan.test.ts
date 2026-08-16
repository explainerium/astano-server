import { describe, expect, it } from "vitest"
import { planMerge, type MergeableLine } from "../../src/domain/basket/mergePlan"

/**
 * The bugs this file exists for, both invisible at the moment they happen:
 * signing in used to drop every option line's parent, so a configured cutter
 * came apart into three unrelated lines, and it dropped every attached drawing
 * — which nobody notices until production asks what shape it is meant to be.
 */

const line = (
	id: string,
	variantId: string,
	over: Partial<MergeableLine> = {}
): MergeableLine => ({ id, variantId, quantity: 1, fileCount: 0, parentItemId: null, ...over })

describe("planMerge", () => {
	it("merges a plain line into a plain line of the same variant", () => {
		const plan = planMerge([line("g1", "cutter", { quantity: 3 })], [line("u1", "cutter")])

		expect(plan.increments).toEqual([{ targetId: "u1", quantity: 3 }])
		expect(plan.copies).toHaveLength(0)
	})

	it("copies a line whose variant is not there yet", () => {
		const plan = planMerge([line("g1", "straw")], [line("u1", "cutter")])

		expect(plan.increments).toHaveLength(0)
		expect(plan.copies.map((c) => c.source.id)).toEqual(["g1"])
	})

	it("never merges a line carrying a drawing", () => {
		// Folding two drawings into one quantity silently picks one of them.
		const plan = planMerge([line("g1", "cutter", { fileCount: 1 })], [line("u1", "cutter")])

		expect(plan.increments).toHaveLength(0)
		expect(plan.copies.map((c) => c.source.id)).toEqual(["g1"])
	})

	it("never merges into an existing line that carries a drawing", () => {
		const plan = planMerge([line("g1", "cutter")], [line("u1", "cutter", { fileCount: 2 })])

		expect(plan.increments).toHaveLength(0)
		expect(plan.copies).toHaveLength(1)
	})

	it("keeps a configured line whole rather than merging its parent away", () => {
		const plan = planMerge(
			[line("g1", "cutter"), line("g2", "engraving", { parentItemId: "g1" })],
			[line("u1", "cutter")]
		)

		// The cutter has an option hanging off it, so it crosses over as its own
		// line — merging it would strand the engraving.
		expect(plan.increments).toHaveLength(0)
		expect(plan.copies.map((c) => c.source.id)).toEqual(["g1", "g2"])
	})

	it("carries an option's parent across rather than dropping it", () => {
		const plan = planMerge(
			[line("g1", "cutter"), line("g2", "engraving", { parentItemId: "g1" })],
			[]
		)

		const option = plan.copies.find((c) => c.source.id === "g2")
		expect(option?.parentSourceId).toBe("g1")
	})

	it("orders parents before the options that point at them", () => {
		const plan = planMerge(
			[
				line("g2", "engraving", { parentItemId: "g1" }),
				line("g3", "box", { parentItemId: "g1" }),
				line("g1", "cutter"),
			],
			[]
		)

		const order = plan.copies.map((c) => c.source.id)
		expect(order.indexOf("g1")).toBeLessThan(order.indexOf("g2"))
		expect(order.indexOf("g1")).toBeLessThan(order.indexOf("g3"))
	})

	it("keeps two configurations of the same variant apart", () => {
		const plan = planMerge(
			[
				line("g1", "cutter", { fileCount: 1 }),
				line("g2", "cutter", { fileCount: 1 }),
			],
			[]
		)

		expect(plan.copies.map((c) => c.source.id)).toEqual(["g1", "g2"])
	})

	it("adds each of two plain lines to the same existing one separately", () => {
		// Two increments rather than one figure worked out here: the caller
		// applies them with `increment`, so both land.
		const plan = planMerge(
			[line("g1", "cutter", { quantity: 2 }), line("g2", "cutter", { quantity: 5 })],
			[line("u1", "cutter")]
		)

		expect(plan.increments).toEqual([
			{ targetId: "u1", quantity: 2 },
			{ targetId: "u1", quantity: 5 },
		])
	})

	it("drops an option whose parent is not coming across", () => {
		const plan = planMerge([line("g2", "engraving", { parentItemId: "missing" })], [])
		expect(plan.copies).toHaveLength(0)
	})

	it("handles an empty guest basket", () => {
		const plan = planMerge([], [line("u1", "cutter")])
		expect(plan).toEqual({ increments: [], copies: [] })
	})
})
