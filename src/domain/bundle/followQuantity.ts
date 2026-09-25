/**
 * How many of an option are ordered when it follows the main product.
 *
 * `unitsPerOption` is how many of the main product one of this option covers:
 * 1 for a single pack per ice cube, 4 for a box of four. So 400 cubes order
 * 100 boxes, and 401 order 101 — rounded **up**, because a part-filled box is
 * still a box, and shipping 401 cubes with 100 boxes means one cube arrives
 * loose.
 *
 * Pure, and shared by the configurator, the cart and the inquiry basket: the
 * three of them disagreeing about this number is exactly the mistake the
 * client reported customers making by hand.
 */
export const followingQuantity = (mainQuantity: number, unitsPerOption: number): number => {
	const per = Number.isFinite(unitsPerOption) && unitsPerOption > 0 ? Math.floor(unitsPerOption) : 1

	// Never 0: an option that is ticked is ordered, however small the main line.
	return Math.max(1, Math.ceil(mainQuantity / per))
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * The main quantity raised to fit whole packs.
 *
 * The client, 25 September: *"your buy 100 ice cubes and choose the box for 6
 * pieces. This doesn't work. Customer has to take 102 ice cubes instead of
 * 100."* 100 ÷ 6 is 17 boxes, and 17 boxes hold 102 — so one box travels with
 * four empty slots unless the cubes are raised to match it.
 *
 * Raised, never lowered: the customer asked for at least this many, and a shop
 * that quietly ships 96 has sent the wrong order. With two pack sizes chosen at
 * once — a box of four and a box of six — it is the least common multiple, 12,
 * because both have to come out whole.
 *
 * Sizes of 1 (a pack per cube) constrain nothing and are ignored.
 */
export const packedMainQuantity = (mainQuantity: number, packSizes: number[]): number => {
	const sizes = packSizes
		.map((size) => (Number.isFinite(size) ? Math.floor(size) : 1))
		.filter((size) => size > 1)

	if (!sizes.length) return mainQuantity

	// LCM of the lot. Capped: a 7 × 11 × 13 combination would otherwise round a
	// hundred cubes up to a thousand, which is not a tidier order but a
	// different one. Above the cap the quantity is left alone and the page says
	// nothing — no pack size in this catalogue comes close.
	const step = sizes.reduce((a, b) => (a * b) / gcd(a, b), 1)
	if (step > 1000) return mainQuantity

	return Math.ceil(mainQuantity / step) * step
}
