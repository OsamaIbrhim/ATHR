import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

/** `?page=&page_size=` — the query every paginated list endpoint accepts. */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  page_size = 50;
}

export type PageQuery = Pick<PageQueryDto, 'page' | 'page_size'>;

export const FIRST_PAGE: PageQuery = { page: 1, page_size: 50 };

/** Prisma `skip`/`take` for a page. */
export const pageArgs = ({ page, page_size }: PageQuery) => ({
  skip: (page - 1) * page_size,
  take: page_size,
});

/** The list envelope products and sales already return. */
export function pageOf<T>(items: T[], total: number, { page, page_size }: PageQuery) {
  return { items, page, page_size, total, total_pages: Math.max(1, Math.ceil(total / page_size)) };
}
