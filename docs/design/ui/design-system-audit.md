# Admin design-system audit (before L1)

Scope: `admin-web/app/globals.css`, `tailwind.config.ts`, `components/ui/*`, `app/layout.tsx`, `app/page.tsx`, `app/products`, `app/inventory`, `app/transfers`, `app/settings`, and screenshot `ATHR-w2a-admin/.screenshots/4-products-list.png`. Nothing has been changed. IDs `DS-n` are referenced from `L1-onboarding.md`.
Contrast figures are computed from the Tailwind hex values (WCAG 2.x).

## Must fix (blocks L1 or breaks accessibility / RTL / data reading)

**DS-1 Sidebar is not responsive.** `Sidebar.tsx` is `w-64 shrink-0 min-h-screen` inside `layout.tsx`'s `flex`; on a 375px phone 256px is taken by the menu and the page gets ~120px. Admin must work on a phone and the count screen is phone-first.
Fix: in `layout.tsx` wrap in a shell: `<header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 bg-athr px-4 text-white">` with a menu `<button aria-label="فتح القائمة" aria-expanded>` and the brand; sidebar `className="hidden md:block w-64 shrink-0 sticky top-0 h-screen overflow-y-auto ..."` and, below `md`, the same nav inside a drawer (`fixed inset-y-0 start-0 w-72 z-40`, backdrop, closes on route change, Esc, focus trap). Main padding `p-4 md:p-6`. Also `sticky top-0 h-screen` fixes the menu scrolling away on long pages.

**DS-2 No visible focus on buttons, links, selects, rows.** `.btn`, `.btn-secondary`, `.btn-accent`, sidebar links and tag remove buttons have no focus style; inputs use `focus:ring-accent/40` = amber at 40% on white, about 1.3:1 — fails WCAG 1.4.11 (3:1) and 2.4.7.
Fix (globals.css): 
```css
:focus-visible { outline: 2px solid #b45309; outline-offset: 2px; }          /* amber-700, 5.0:1 on white */
.input, .select, .input-sm { @apply focus:outline-none focus:ring-2 focus:ring-amber-700 focus:border-amber-700; }
```
Inside the dark sidebar use `focus-visible:outline-white`. Remove the `focus:ring-accent/40` copies (also in `TagInput`'s `focus-within:ring-accent/40`).

**DS-3 Placeholder and "empty value" text fail contrast.** `placeholder:text-gray-400` (#9ca3af) on white = 2.5:1; "—" cells use `text-gray-400` in products and `BarcodeChips`; `text-gray-500` (#6b7280) used as body/subtitle text **on the page background #f6f6f7** (PageHeader subtitle, dashboard labels) = about 4.4:1, just under AA 4.5.
Fix: placeholders `text-gray-500`; missing-value dashes `text-gray-500` with `aria-label="لا يوجد"`; text that sits directly on `#f6f6f7` uses `text-gray-600` (#4b5563, 7:1). Keep `text-gray-500` only on white cards for secondary text.

**DS-4 `Field` is not accessible and cannot carry more than one control.** It wraps everything in `<label>` (`TagInput` puts remove buttons inside a label: clicking the label activates the first control and screen readers announce a soup), the error is not tied to the control (`aria-describedby`/`aria-invalid` missing), required is only a red `*` (no `aria-required`), error text is `text-xs`.
Fix: `useId()`; render `<label htmlFor>` + control via render-prop `children: (props: { id, 'aria-describedby', 'aria-invalid', 'aria-required' }) => ReactNode` (keep a simple-children fallback); message `id`; error is `text-sm text-red-700` with a leading icon and `role="alert"` only when it first appears; required adds `<span className="sr-only">(مطلوب)</span>` and the asterisk gets `ms-0.5` (logical) instead of `mr-0.5`.

**DS-5 Money and quantity are ambiguous / not LTR-safe.** Products list: `${Number(cost_price)} ج` — bare `ج` is not a clear currency, no thousands separator, no fixed decimals; stock is a raw sum of decimals (`24.500` would appear with noise) with no unit. In RTL a negative number typed inline renders as `5-`. Dashboard shows `{stats.total_sales} ج` with the same issues.
Fix: add `lib/format.ts` (`formatMoney`, `formatQty`, `formatDate`) and the `Num` component (spec §7/§0.1 of L1): `dir="ltr"`, `tabular-nums`, U+2212 minus, `ج.م` suffix, unit precision. Replace these usages. Numeric table cells `text-end` with matching `th`.

**DS-6 `Cairo` is referenced but never loaded.** `globals.css` sets `font-family: 'Cairo', …` but `layout.tsx` has no `next/font` or `<link>`; the product screenshot renders in the OS fallback (Segoe/Tahoma) — the UI looks different on every machine and Arabic figures/weights are unpredictable.
Fix: `import { Cairo } from 'next/font/google'` with `subsets: ['arabic','latin']`, `weight: ['400','500','700']`, `display: 'swap'`, `variable: '--font-cairo'`; apply to `<html>`; in `tailwind.config.ts` `fontFamily: { sans: ['var(--font-cairo)', 'Segoe UI', 'system-ui', 'sans-serif'] }`. (This is `next/font`, not a new dependency.) Also set `font-variant-numeric: tabular-nums` only via `.tabular`/`Num`, not on the whole body.

**DS-7 Back arrow points the wrong way in RTL.** `PageHeader` renders `← {back.label}`; in RTL "back" points right.
Fix: use `→` (or an inline chevron with `rtl:rotate-180` from a neutral LTR SVG). Mirror any other directional glyph the same way.

**DS-8 `DataTable` cannot serve L1.** Issues: loading is a text line shown *together with* any stale rows (no skeleton, layout jumps); the empty state renders under an empty `<table>` header; `key={column.header}` — the products action column has header `''` and any two columns with the same header collide; no caption; `th` has no `scope`; no alignment per column (numbers left/right mixed); no mobile presentation (a 6-column table scrolls sideways on a phone); no sticky header for long lists; no row error/selected styling; error state handled outside by each page.
Fix (props): `columns[].key: string`, `columns[].align?: 'start' | 'end'`, `columns[].hideBelow?: 'md'`; `loading` -> render 6 skeleton rows of the same column widths (`animate-pulse`, `motion-reduce:animate-none`) and **not** the stale rows; `error?: { message: string; onRetry: () => void }`; `mobileCard?: (row) => ReactNode` rendered below `md` instead of the table; `stickyHeader?: boolean` (`thead th { sticky top-0 }` inside a `max-h` container); `rowClassName?`; `caption?: string` (`sr-only`); `th scope="col"`. Empty state must replace the table (not sit under it).

**DS-9 Inventory, Transfers and Settings pages must not be used as patterns, and `/inventory` silently loses data.** They are one-line minified JSX, hand-rolled `label`/`select` (not `Field`), and `/inventory` loads `products?page_size=100` into a native `<select>` (and `/transfers` 200): a shop with more than 100 products cannot pick the rest, with no warning. `products/page.tsx` uses native `confirm()` for deactivation and `<a>` links on the dashboard force full reloads (`app/page.tsx` quick links should be `next/link`).
Fix: L1 builds `ItemPicker`; before launch, replace the native selects in `/inventory` and `/transfers` with it, `confirm()` with `ConfirmDialog`, dashboard `<a>` with `Link`. Reformat those files when touched.

**DS-10 Touch targets below 44px; no disabled-state explanation.** `.btn` = `px-4 py-2` with 24px line-height = 40px; `.input` 42px; text buttons (`تعديل`, `تعطيل`) are bare text with no padding (about 20px high) and sit 12px apart — mis-taps are easy, and "تعطيل" is a destructive one-tap action next to "تعديل".
Fix: below `md` make `.btn`, `.btn-secondary`, `.btn-accent`, `.input`, `.select` `min-h-11` (44px); add `.btn-link` (`inline-flex min-h-11 items-center px-2 md:min-h-0 md:px-1`); destructive text actions go behind `ConfirmDialog` and get `.btn-danger-link`. Also `.btn:hover:bg-black` applies to disabled buttons — use `enabled:hover:`.

## Should fix (hierarchy, consistency, missing pieces)

**DS-11 Active nav item is colour-only.** Active = `bg-white/15` only; no `aria-current`. Fix: `aria-current={active ? 'page' : undefined}` and `border-s-4 border-accent font-semibold` on active. Remove the meaningless `ar-EG • EGP` footer line. `text-white/50` on #111827 is OK (5.1:1) but keep >= white/60 for readability. Group headings per L1 §1.1 (`text-xs font-semibold text-white/60 px-3 mt-4 mb-1`).

**DS-12 Logical properties.** `th { text-right }` in globals.css -> `text-start`; `.status-dot { ml-2 }` -> `ms-2`; `Field` `mr-0.5` -> `ms-0.5`; grep for `ml-|mr-|pl-|pr-|left-|right-|text-left|text-right|rounded-l|rounded-r` before L1 and convert; add an ESLint `no-restricted-syntax`/tailwind plugin rule later (needs tech lead, no new dependency now).

**DS-13 Links have three different looks.** Products list uses `text-blue-700` links and `hover:text-blue-700` names; cards on settings use amber hover ring; PageHeader back link is gray. Decision: text links = `text-blue-700 hover:underline underline-offset-2` (7:1 on white); accent amber is for focus rings, active markers and the single `btn-accent`; cards that are links get `hover:border-gray-400` plus a visible focus ring, not an amber ring.

**DS-14 Buttons lack a scale and states.** Only `.btn`, `.btn-accent`, `.btn-secondary`. Add `.btn-danger` (`bg-red-700 text-white hover:bg-red-800`, 6.5:1), `.btn-sm` (`px-3 py-1.5 text-sm`), `.btn-icon` (44x44 min), `aria-busy` loading style (spinner-free: text "جارٍ…" + `opacity-70 pointer-events-none`). `.btn-accent` uses black on amber (10:1, good) — never white on amber (2.1:1); state this rule in the doc header of globals.css.

**DS-15 No semantic colour tokens.** `tailwind.config.ts` has only `athr` and `accent`; status colours are scattered (`bg-red-50 text-red-800`, `badge bg-gray-100`). Add a status palette as classes (all AA on their own tint):
```css
.badge-ok      { @apply badge bg-green-50  text-green-800  ring-1 ring-inset ring-green-200; }
.badge-warn    { @apply badge bg-amber-50  text-amber-900  ring-1 ring-inset ring-amber-300; }
.badge-danger  { @apply badge bg-red-50    text-red-800    ring-1 ring-inset ring-red-200; }
.badge-info    { @apply badge bg-blue-50   text-blue-800   ring-1 ring-inset ring-blue-200; }
.badge-neutral { @apply badge bg-gray-100  text-gray-800   ring-1 ring-inset ring-gray-200; }
.alert-danger  { @apply rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 text-sm; }  /* + warn/info/ok */
```
and in `tailwind.config.ts` add `colors.surface: '#f6f6f7'` and use it instead of the `bg-[#f6f6f7]` magic value in `layout.tsx`. `StatusBadge` wraps these.

**DS-16 Card padding is inconsistent.** `.card` is `p-5`; tables use `className="card p-2"`. Add `.card-flush { @apply p-0 overflow-hidden }` for table cards and keep the table cell padding for spacing; define the spacing scale in the doc: page `space-y-6` (was mixed `space-y-4/6`), card inner `p-5` (`p-4` below md).

**DS-17 Forms lack an error/disabled/size system.** `.input` has no `aria-invalid` style, no disabled style, and `.input-sm` is a separate copy. Add `.input[aria-invalid="true"] { @apply border-red-600 ring-1 ring-red-600 }`, `.input:disabled { @apply bg-gray-100 text-gray-500 }`, `.input-num { @apply text-start tabular-nums; direction: ltr }`, and make `.input-sm` derive from `.input`. Every input needs a label or `aria-label` (the products search has placeholder only).

**DS-18 Toasts vs sticky bars.** `Toaster position="top-center"` overlapped the products header in the screenshot and will cover the sticky action bars on phones if moved to bottom. Keep top-center but `offset={16}` and `toastOptions={{ duration: 4000 }}`; errors must not be toast-only (rule in L1 §0.2). Success toasts `role=status` are fine.

**DS-19 EmptyState is one generic icon and not announced.** Add `icon?: ReactNode`, `role="status"`, and optional `tone` for positive empties ("لا توجد أصناف بالسالب"). Keep the hint max 2 lines.

**DS-20 Dashboard cards are hand-written.** Four copy-pasted `.card` blocks, values as `{loading ? '—' : ...}` (dash at 2xl size looks like data). Use `StatCard` with a skeleton and number formatting (DS-5). Quick-links `.btn` ×4 all same weight with one `btn-accent` on "التقارير" — the accent should mark the one primary next step, which for a new shop is the checklist, not reports.

## Polish

- **DS-21** Body class `rtl` duplicates `<html dir="rtl">`; drop `.rtl`.
- **DS-22** `button:disabled { opacity-50 }` globally also hits icon/text buttons inside tables; fine, but pair with `aria-disabled` explanation rule (L1 §0.2).
- **DS-23** `TagInput` remove button is a bare `×` glyph 12px; make it a 24px hit area (`min-w-6 min-h-6`) and keep `aria-label`.
- **DS-24** `th` is 12px gray-600 on gray-50: fine contrast (7:1) but add `sticky` support and `text-start` (DS-12). `td` vertical padding `py-2` gives 36px rows: use `py-2.5` for cashier-facing admin lists, `py-3` below `md`.
- **DS-25** Transitions: add `motion-reduce:transition-none` to `.btn*`; skeleton `motion-reduce:animate-none`.
- **DS-26** Status dots (`.status-dot`) are colour-only; never use without a word.
- **DS-27** The floating dark "N" circle at the start edge in the screenshot is the Next.js dev indicator (dev only) — ignore, but do not take screenshots for review with it on (`devIndicators: false` in `next.config.js` during captures).
- **DS-28** Dates: `toLocaleString('ar-EG')` (inventory page) produces Arabic-Indic digits while everything else is Western; centralise in `formatDate` with `ar-EG-u-nu-latn`.

## Consistency decisions made (one way to do each thing)

| Need | The one way |
|---|---|
| Pick an item | `ItemPicker` (server search + scan) — never a native `<select>` of products |
| Confirm a risky action | `ConfirmDialog` — never `confirm()` |
| Show status | `StatusBadge` (colour + word) |
| Table | `DataTable` (with skeleton, align, mobile card) |
| Form field | `Field` with render-prop (id wiring) |
| Numbers/money | `Num` / `formatMoney` / `formatQty` (Western digits, `ج.م`) |
| Text link | `text-blue-700 hover:underline` |
| Success / error feedback | toast for success; inline banner/field error for failures |
| Page shell | `PageHeader` + `.card` blocks, `space-y-6` |
| Mobile navigation | top bar + drawer (DS-1) |

## Suggested order
DS-1, DS-2, DS-3, DS-6, DS-7 (global, small) -> DS-4, DS-5, DS-8, DS-15, DS-17 (needed by every L1 screen) -> DS-9, DS-10, DS-11 with the L1 screens -> the rest.
