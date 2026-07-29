import type { User, UserRole, UserStatus } from "@prisma/client"

/** User shape returned by the API — never includes passwordHash. */
export interface PublicUser {
	id: string
	email: string
	role: UserRole
	status: UserStatus
	firstName: string | null
	lastName: string | null
	company: string | null
	phone: string | null
	vatNumber: string | null
	locale: string
	createdAt: Date
}

export interface AuthTokens {
	accessToken: string
	refreshToken: string
}

export interface AuthResult extends AuthTokens {
	user: PublicUser
}

export const toPublicUser = (user: User): PublicUser => ({
	id: user.id,
	email: user.email,
	role: user.role,
	status: user.status,
	firstName: user.firstName,
	lastName: user.lastName,
	company: user.company,
	phone: user.phone,
	vatNumber: user.vatNumber,
	locale: user.locale,
	createdAt: user.createdAt,
})
