import { ApiError, getCurrentUser } from "@/lib/api";
import type { UserRead } from "@/types/user";

/**
 * Session helpers.
 *
 * The access token now lives in an httpOnly cookie, which JavaScript cannot
 * read. That means there is no synchronous way to answer "am I signed in?" the
 * way the old localStorage `getToken()` did - it takes a request to the server.
 * Anything gating on auth has to await this.
 */

/** Returns the signed-in user, or null when there is no valid session. */
export async function fetchSession(): Promise<UserRead | null> {
  try {
    return await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    // Network failures and 5xx are not "logged out" - let the caller decide.
    throw err;
  }
}
