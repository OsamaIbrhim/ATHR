import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

export function requireResourceId(value: unknown, field = 'id'): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !isUUID(normalized)) {
    throw new BadRequestException({
      code: 'RESOURCE_ID_INVALID',
      message: `${field} must be a valid UUID`,
      field,
    });
  }
  return normalized;
}
