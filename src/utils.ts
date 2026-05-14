/**
 * Server-side utility functions for ft-quality-operation-platform.
 */

/** Get the current user's email address. */
export function getCurrentUserEmail(): string {
  return Session.getActiveUser().getEmail();
}

/** Log a server-side message. */
export function log(message: string): void {
  Logger.log(`[ft-quality-operation-platform] ${message}`);
}
