/**
 * Cursor pagination request/response types — API Contract v1.0 §33–§34.
 *
 * Cursor pagination is the baseline for operational lists; offset pagination
 * is out of scope here (reserved for bounded admin/report views per §33).
 */

export interface PageRequest {
  readonly limit?: number;
  readonly after?: string;
  readonly before?: string;
}

export interface PageMeta {
  readonly limit: number;
  readonly next_cursor: string | null;
  readonly previous_cursor: string | null;
  readonly has_more: boolean;
}
