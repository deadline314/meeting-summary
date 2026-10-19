// Error codes shared by API and client; the client translates each code via i18n `error.<code>`.
export const ERROR_CODES = [
  'bad_request',
  'validation',
  'unauthenticated',
  'not_found',
  'conflict',
  'rate_limited',
  'account_disabled',
  'invalid_admin_key',
  'admin_key_locked',
  'last_owner',
  'last_project_owner',
  'payload_too_large',
  'quota_exceeded',
  'unsupported_type',
  'submission_closed',
  'daily_limit',
  'trial_required',
  'project_inactive',
  'key_taken',
  'cycle',
  'depth_exceeded',
  'not_visible',
  'scope',
  'limit_reached',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; requestId: string; params?: Record<string, string | number> }
}
