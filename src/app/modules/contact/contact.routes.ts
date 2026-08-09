import { Router } from "express"
import { z } from "zod"
import { notifyStaff } from "../../../helpers/mailer"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"

const submitSchema = z.object({
	body: z.object({
		name: z.string().trim().min(1).max(160),
		email: z.string().trim().toLowerCase().email(),
		phone: z.string().trim().max(50).optional(),
		company: z.string().trim().max(200).optional(),
		subject: z.string().trim().max(200).optional(),
		message: z.string().trim().min(1).max(5000),
		/// Honeypot. Real users never see this field, so anything in it is a bot.
		/// Deliberately permissive here — a validation error would tell the bot
		/// exactly which field gave it away. The handler decides instead.
		website: z.string().max(500).optional(),
	}),
})

const listSchema = z.object({
	query: z.object({
		handled: z.enum(["true", "false"]).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const ContactRoutes = Router()

ContactRoutes.post(
	"/",
	optionalAuth,
	writeLimiter,
	validateRequest(submitSchema),
	catchAsync(async (req, res) => {
		// Bots fill every field they find. Answer 201 anyway — telling a spammer
		// their submission was rejected only teaches them to try again.
		if (req.body.website) {
			sendResponse(res, {
				statusCode: httpStatus.CREATED,
				message: t("contact.sent", req.locale),
			})
			return
		}

		const saved = await prisma.contactMessage.create({
			data: {
				name: req.body.name,
				email: req.body.email,
				phone: req.body.phone ?? null,
				company: req.body.company ?? null,
				subject: req.body.subject ?? null,
				message: req.body.message,
				locale: req.locale,
				userId: req.user?.sub ?? null,
				ipAddress: req.ip ?? null,
			},
		})

		// Stored first, then emailed. If mail fails the enquiry still exists —
		// losing a potential customer to an SMTP hiccup is not acceptable.
		await notifyStaff({
			kind: "staff-new-contact",
			locale: req.locale,
			subject: t("staff.newContact.subject", req.locale, {
				subject: req.body.subject || req.body.name,
			}),
			title: t("staff.newContact.title", req.locale),
			intro: t("staff.newContact.intro", req.locale, {
				name: req.body.name,
				email: req.body.email,
				message: req.body.message.slice(0, 500),
			}),
		})

		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			message: t("contact.sent", req.locale),
			data: { id: saved.id },
		})
	})
)

export const AdminContactRoutes = Router()

AdminContactRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminContactRoutes.get(
	"/",
	validateRequest(listSchema),
	catchAsync(async (req, res) => {
		const q = req.query as unknown as { handled?: string; page?: number; limit?: number }
		const page = Number(q.page ?? 1)
		const limit = Number(q.limit ?? 20)

		const where =
			q.handled === "true"
				? { handledAt: { not: null } }
				: q.handled === "false"
					? { handledAt: null }
					: {}

		const [rows, total] = await Promise.all([
			prisma.contactMessage.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: (page - 1) * limit,
				take: limit,
			}),
			prisma.contactMessage.count({ where }),
		])

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: rows,
			meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
		})
	})
)

AdminContactRoutes.patch(
	"/:id/handled",
	validateRequest(
		z.object({
			params: z.object({ id: z.string().uuid() }),
			body: z.object({ note: z.string().trim().max(1000).optional() }),
		})
	),
	catchAsync(async (req, res) => {
		const updated = await prisma.contactMessage.update({
			where: { id: req.params.id as string },
			data: {
				handledAt: new Date(),
				handledBy: req.user!.sub,
				internalNote: req.body.note ?? null,
			},
		})

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("contact.marked", req.locale),
			data: updated,
		})
	})
)

export default ContactRoutes
