# TODOS

## Finance

### Measure receipt-search latency and optimize only if needed

**What:** Measure Finance receipt-search latency after server-side pagination and sorting indexes ship; set an agreed p95 target, and evaluate exact/prefix lookup or a trigram index only if measured latency exceeds it.

**Why:** Current receipt history is modest, so a leading-wildcard search scan may be acceptable today. Measurement will show whether name/reference search needs more indexing without adding write and maintenance cost prematurely.

**Pros:** Prevents premature indexing and ties any search optimization to observed staff-facing latency.

**Cons:** Requires a representative measurement and agreement on a p95 threshold before the optimization decision.

**Context:** The 2026-10-15 read-only production trace covered 4,439 receipts. Search for N565 used leading-wildcard ILIKE across both payment sources and scanned them; the current query plan does a small full scan. Start with FeeCollections.tsx and src/lib/financeReceiptSearch.ts. Capture user-visible search latency and database query latency against representative data, record a baseline, and agree on the p95 threshold before deciding whether to optimize. The receipt pagination and sort-index changes in fix-missing-receipt-record should land first.

**Effort:** S
**Priority:** P2
**Depends on:** Finance receipt pagination and sort indexes.

## Completed
