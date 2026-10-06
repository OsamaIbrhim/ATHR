# W3 — API contract (sales)

> Status: built up as the W3 backend lands. Companion to `W3-sales.md` (design). Merges together with W3-POS.

## Known limits

- **`TaxRoundingPolicy = 'document'` is not honoured.** Tax is rounded per line (`line` policy) for every sale, whatever the tax code says: a document-level rounding would make a line's stored tax depend on the other lines, which breaks returns of single lines. The value is kept in the tax snapshot as written; no W3 behaviour depends on it. Revisit only if a customer needs invoice-level rounding.
