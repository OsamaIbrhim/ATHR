import { HttpException } from '@nestjs/common';

/**
 * A business refusal in the `{ code, message, message_ar }` shape every admin
 * and POS client already reads (`ApiExceptionFilter`). `data` carries machine
 * readable specifics (a variant id, the id of the record that is in the way).
 */
export function domainError(
  status: number,
  code: string,
  message: string,
  message_ar: string,
  data?: Record<string, unknown>,
): HttpException {
  return new HttpException({ code, message, message_ar, ...(data ? { data } : {}) }, status);
}

export const CONFLICT = 409;
export const UNPROCESSABLE = 422;
export const NOT_FOUND = 404;
export const FORBIDDEN = 403;
