/** Pagination helpers. The decorated query DTO lives in page-query.dto.ts so repositories do not load class-validator. */
export type PageQuery = { page: number; page_size: number };

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
