/** Cookie carrying the refresh token. httpOnly — never readable from JS. */
export const REFRESH_COOKIE = "astano_refresh"

/** Password reset links stay valid for one hour. */
export const RESET_TOKEN_TTL = "1h"

/** bcrypt cost. 12 is the current sensible floor for a login path. */
export const BCRYPT_ROUNDS = 12
