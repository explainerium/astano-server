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
