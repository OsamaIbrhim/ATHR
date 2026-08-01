import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  CommandAcceptedEnvelope,
  CommandSuccessEnvelope,
  ListEnvelope,
  PageMeta,
  QueryEnvelope,
} from '@athr/contracts';

/**
 * Opt-in envelope convention. A handler without `@Envelope(...)` is passed
 * through completely unchanged — this is what keeps every not-yet-migrated
 * route's response byte-identical after this interceptor is registered
 * globally. Later WPs' controllers depend on the exact shapes below, so
 * change them deliberately, not incidentally.
 *
 * - `@Envelope('query')`: handler returns the raw resource. Wrapped as
 *   `{ data, meta: { request_id, correlation_id, generated_at }, links: { self } }`.
 * - `@Envelope('list')`: handler returns `{ items, page }` where `page` is a
 *   `PageMeta` (from `@athr/contracts`). Wrapped as `{ data: items, page, meta, links }`.
 * - `@Envelope('command')`: handler returns the raw resource for a synchronous
 *   command — wrapped as the "succeeded" shape with a generated `command_id`.
 *   If the handler set an explicit `202` status (`@HttpCode(202)`) and returns
 *   `{ operation_id, status_url }`, it is wrapped as the "accepted" async shape
 *   instead.
 */
export type EnvelopeKind = 'query' | 'list' | 'command';

export const ENVELOPE_KIND_METADATA_KEY = 'athr:envelope-kind';

export const Envelope = (kind: EnvelopeKind): MethodDecorator => SetMetadata(ENVELOPE_KIND_METADATA_KEY, kind);

interface ListSourceShape {
  readonly items: readonly unknown[];
  readonly page: PageMeta;
}

function isListSource(value: unknown): value is ListSourceShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ListSourceShape>;
  return Array.isArray(candidate.items) && typeof candidate.page === 'object' && candidate.page !== null;
}

interface CommandAcceptedSourceShape {
  readonly operation_id: string;
  readonly status_url: string;
}

function isCommandAcceptedSource(value: unknown): value is CommandAcceptedSourceShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CommandAcceptedSourceShape>;
  return typeof candidate.operation_id === 'string' && typeof candidate.status_url === 'string';
}

function withCursorParam(url: string, cursor: string): string {
  const [path, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('page[after]', cursor);
  return `${path}?${params.toString()}`;
}

interface RequestContext {
  requestId?: string;
  correlationId?: string;
  originalUrl?: string;
  url?: string;
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const kind = this.reflector.get<EnvelopeKind | undefined>(ENVELOPE_KIND_METADATA_KEY, context.getHandler());
    if (!kind) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<{ statusCode?: number }>();
    const requestId = request.requestId ?? randomUUID();
    const correlationId = request.correlationId ?? randomUUID();
    const selfUrl = request.originalUrl ?? request.url ?? '';

    return next.handle().pipe(
      map(
        (
          value: unknown,
        ): QueryEnvelope<unknown> | ListEnvelope<unknown> | CommandSuccessEnvelope<unknown> | CommandAcceptedEnvelope => {
          if (kind === 'list' && isListSource(value)) {
            return {
              data: value.items,
              page: value.page,
              meta: { request_id: requestId, generated_at: new Date().toISOString() },
              links: {
                self: selfUrl,
                next:
                  value.page.has_more && value.page.next_cursor
                    ? withCursorParam(selfUrl, value.page.next_cursor)
                    : null,
              },
            };
          }

          if (kind === 'command') {
            if (response.statusCode === 202 && isCommandAcceptedSource(value)) {
              return {
                data: { operation_id: value.operation_id, status: 'accepted', status_url: value.status_url },
                meta: { request_id: requestId },
              };
            }

            return {
              data: {
                resource: value,
                command: { command_id: `cmd_${randomUUID()}`, status: 'succeeded' },
              },
              meta: { request_id: requestId, correlation_id: correlationId },
            };
          }

          return {
            data: value,
            meta: { request_id: requestId, correlation_id: correlationId, generated_at: new Date().toISOString() },
            links: { self: selfUrl },
          };
        },
      ),
    );
  }
}
