import type { Request, RequestHandler, Response } from "express"
import { env } from "../../../config"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { durationToMs } from "../../../shared/token"
import { t } from "../../../i18n"
import { REFRESH_COOKIE } from "./auth.constant"
import { AuthService } from "./auth.service"

const setRefreshCookie = (res: Response, token: string): void => {
	res.cookie(REFRESH_COOKIE, token, {
		httpOnly: true,
		secure: env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: durationToMs(env.JWT_REFRESH_EXPIRES_IN),
		path: "/",
	})
}

const device = (req: Request) => ({
	userAgent: req.get("user-agent") ?? undefined,
	ipAddress: req.ip,
})

const register: RequestHandler = catchAsync(async (req, res) => {
	const result = await AuthService.register(req.body, device(req))
	setRefreshCookie(res, result.refreshToken)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("auth.registered", req.locale),
		data: result,
	})
})

const login: RequestHandler = catchAsync(async (req, res) => {
	const result = await AuthService.login(req.body, device(req))
	setRefreshCookie(res, result.refreshToken)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.loggedIn", req.locale),
		data: result,
	})
})

const refresh: RequestHandler = catchAsync(async (req, res) => {
	// Cookie first (browsers), body second (Postman and native clients).
	const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? req.body?.refreshToken
	const result = await AuthService.refresh(token ?? "", device(req))
	setRefreshCookie(res, result.refreshToken)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.refreshed", req.locale),
		data: result,
	})
})

const logout: RequestHandler = catchAsync(async (req, res) => {
	const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? req.body?.refreshToken
	await AuthService.logout(token)
	res.clearCookie(REFRESH_COOKIE, { path: "/" })

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.loggedOut", req.locale),
	})
})

const me: RequestHandler = catchAsync(async (req, res) => {
	const user = await AuthService.me(req.user!.sub)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: user,
	})
})

const forgotPassword: RequestHandler = catchAsync(async (req, res) => {
	const result = await AuthService.forgotPassword(req.body.email)

	// Response is identical whether or not the address exists.
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.resetSent", req.locale),
		data: result,
	})
})

const resetPassword: RequestHandler = catchAsync(async (req, res) => {
	await AuthService.resetPassword(req.body.token, req.body.password)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.passwordReset", req.locale),
	})
})

const changePassword: RequestHandler = catchAsync(async (req, res) => {
	await AuthService.changePassword(
		req.user!.sub,
		req.body.currentPassword,
		req.body.newPassword
	)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("auth.passwordChanged", req.locale),
	})
})

export const AuthController = {
	register,
	login,
	refresh,
	logout,
	me,
	forgotPassword,
	resetPassword,
	changePassword,
}
