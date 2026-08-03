import { Request } from 'express';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantContextResolver } from './tenant-context.resolver';
import { TenantContext } from './tenant-context.type';

export interface RequestWithIdentity extends Request {
  user: { sub: string };
  requestId?: string;
  correlationId?: string;
}

/**
 * Shared per-controller call site for this WP's new endpoints. This is
 * deliberately *not* a global guard (WP-007 does that global wiring) — each
 * controller method calls this explicitly, which is exactly what "provider,
 * not yet wired as a global guard" (WP-006 §2 item 1) means in practice.
 */
export async function resolveContextOrThrow(
  resolver: TenantContextResolver,
  req: RequestWithIdentity,
  tenantId: string,
): Promise<TenantContext> {
  const result = await resolver.resolve({
    authenticatedIdentityId: req.user.sub,
    requestedTenantId: tenantId,
    requestId: req.requestId ?? 'unknown',
    correlationId: req.correlationId ?? 'unknown',
  });

  if (result.ok === false) {
    throw new AthrDomainError(result.failure.code as any, result.failure.message);
  }
  return result.value;
}
