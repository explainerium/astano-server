import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { t } from "../../../i18n"
import ApiError from "../../errors/ApiError"
import { InvoiceService } from "./invoice.service"

const stream: RequestHandler = catchAsync(async (req, res) => {
	const id = req.params.id as string
	const isStaff = req.user?.role === "ADMIN" || req.user?.role === "SHOP_MANAGER"

	// A customer may download only their own invoice. 404 rather than 403, so
	// the existence of someone else's order is not disclosed.
	if (!isStaff) {
		const own = await prisma.order.findFirst({
			where: { id, userId: req.user!.sub },
			select: { id: true },
		})
		if (!own) {
			throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
		}
	}

	const { pdf, filename } = await InvoiceService.generate(id)

	res.setHeader("Content-Type", "application/pdf")
	res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
	res.setHeader("Content-Length", String(pdf.length))
	res.setHeader("Cache-Control", "private, no-store")
	res.send(pdf)

	// t() referenced so the module's localized errors stay wired up.
	void t
})

export const InvoiceController = { stream }
