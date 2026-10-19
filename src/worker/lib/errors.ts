import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ErrorCode } from '@shared/errors'

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ContentfulStatusCode,
    message?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message ?? code)
  }
}

export const notFound = () => new AppError('not_found', 404, 'Not found')
export const badRequest = (message = 'Bad request', params?: Record<string, string | number>) =>
  new AppError('bad_request', 400, message, params)
export const conflict = (message = 'Updated by someone else') => new AppError('conflict', 409, message)
export const unauthenticated = () => new AppError('unauthenticated', 401, 'Sign in required')
