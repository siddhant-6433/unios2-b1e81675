# Library software landscape — analysis and fit for UniOs

_Status: analysis. Companion to `docs/library-module-design.md`._

## Why this document

UniOs already ships a library module (catalog, circulation, digitization, approvals,
enrichment). Before finalising the design we surveyed how established library systems
work, what they get right, and which of their ideas are worth adopting — and,
importantly, which are not, because UniOs is an **integrated school-ERP module**, not a
standalone library.

## Evaluation criteria

| Criterion | Why it matters for UniOs |
|---|---|
| Cataloguing model | MARC21 is the library lingua franca. We store it but should not make it the primary UX. |
| Accessioning | Indian institutions must keep an **accession register** with a durable accession number per physical copy. |
| Circulation rules | Loan period, limits, renewals, fines per branch/institution/course. |
| Bulk legacy import | Registries arrive as Excel/CSV; importing thousands of rows and *approving* them is the core onboarding job. |
| Discovery / OPAC | Students and faculty need to search titles and see availability. |
| Authority control | Authors/publishers must normalise so search and reports are trustworthy. |
| Integrations | Ties into admissions (students), fees (fines), identity (roles), WhatsApp/email. |
| Multi-tenancy | One deployment serves many campuses and institutions, some sharing a library. |
| Cost & hosting | Must run on the existing Supabase/edge stack; no per-seat licence. |
| Mobile | Staff scan barcodes on phones; students browse on phones. |
| Offline/robustness | Registers and scanners are flaky; imports must be idempotent. |

## The landscape

### 1. Full ILS / LMS

| Product | Model | Notable strengths | Why we don't adopt wholesale |
|---|---|---|---|
| **Koha** | Open source, GPL | The reference open-source ILS. Real MARC21/RDA cataloguing, authority files, Z39.50/SRU copy cataloguing, acquisitions, serials, a circulation rules engine, OPAC, SIP2, reports. Huge community, active releases. | Heavy operational surface (Perl/Plack, Zebra/Elasticsearch, separate DB). Would duplicate identity, students and fees already in UniOs. |
| **Evergreen** | Open source | Built for **library consortia** — multiple branches sharing a catalog, which is close to our shared-library model. Robust circulation and holds. | Likewise a separate platform; consortia concepts are heavier than a campus group. |
| **LibSys** | Commercial (India) | Widely used in Indian universities; strong accession registers and MARC. | Proprietary, per-install cost, no API-first integration into our ERP. |
| **SOUL 3.0** | Commercial/INFLIBNET-linked (India) | Standard in Indian academic libraries; accession register, cataloguing, circulation. | Desktop-era UX, licensing, awkward integration. |
| **NewGenLib** | Open source (India) | MARC, acquisitions, serials; born in the Indian library context. | Less active; still a separate system. |
| **Ex Libris Alma + Primo** | Commercial SaaS | Best-in-class unified resource management + discovery for large universities. | Enterprise pricing and complexity; overkill for a school group. |
| **III Sierra / Polaris** | Commercial | Strong public-library circulation. | Proprietary. |
| **OCLC WorldShare** | Commercial/co-op | World-class shared cataloguing data. | Membership model. |
| **Follett Destiny / Alexandria** | Commercial K-12 | Purpose-built for schools: simple cataloguing, reading programmes, textbook management. | Closed ecosystem. |

**Takeaway:** nobody adopts a full ILS and then rebuilds admissions/fees inside it.
The winning pattern for an ERP is a **right-sized LMS** that reuses the ERP's identity,
students and finance, and borrows only the *concepts* below.

### 2. Metadata & discovery sources

| Source | Use | Notes |
|---|---|---|
| **Google Books API** | ISBN/title → title, authors, publisher, year, cover | Great coverage; rate-limited; no key needed for low volume. Already integrated. |
| **Open Library API** | Same, plus covers | No key, generous; used as the enrichment `prefer` source. Already integrated. |
| **Z39.50 / SRU** | Copy cataloguing from library catalogs (LC, university catalogs) | Powerful for real MARC records; a phase-2 addition. |
| **ISBNdb / Bowker** | Commercial metadata | Paid; not needed yet. |
| **Calibre / Calibre-Web** | E-book library management | Different problem (DRM/e-book lending); out of scope. |

### 3. Modern lightweight tools

| Product | Use |
|---|---|
| **TinyCat / LibraryThing** | Tiny library OPAC; validates that a simple discovery UI beats an ILS for small collections. |
| **OpenBiblio / OPALS** | Minimal open-source catalogs; useful as UX benchmarks, not platform choices. |

## Feature-by-feature: what we adopt

| Capability seen in ILS software | Adopt? | How it lands in UniOs |
|---|---|---|
| Accession register + per-copy accession number | **Yes (done)** | `library_items.accession_no`, unique per institution; register rows carry the legacy number through approval. |
| Bib record separate from copy (title vs item) | **Yes (done)** | `library_books` vs `library_items`. |
| Authority control for authors/publishers | **Yes (done)** | `library_authors` / `library_publishers` with normalisation + fuzzy merge. |
| Validated copy-cataloguing (never trust raw imports) | **Yes (done + improved)** | Digitization queue with review → approve; nothing enters the catalog unreviewed. |
| Duplicate detection | **Yes (improved)** | ISBN/accession/barcode checks + server-side “already imported?” gate. |
| Circulation rules (period/limit/renewals/fines) | **Yes (done)** | `library_settings` per branch + `library_validate_loan_issue`. |
| Holds / reservations queue | **Yes (new)** | `library_holds` + `library_place_hold` for patrons. |
| Barcode/spine labels | **Yes (done)** | Code‑39 label printing. |
| Bulk register import with approval | **Yes (improved)** | Batch import → paged review → **bulk approve** that mints accessions. |
| MARC21 as the native model | **No** | Keep MARC in `metadata jsonb` for import/export; don't make staff think in MARC tags. |
| Z39.50/SRU copy cataloguing | **Later** | Phase 2; the enrichment API covers most needs today. |
| Acquisitions / vendor ordering | **Later** | Adjacent to Finance; design later with the procurement module. |
| Serials/periodicals management | **Later** | Real need for journals; phase 2. |
| SIP2 / self-check kiosks | **No (for now)** | Mobile scanning covers the need. |
| Reading programmes / gamification | **No** | Not core to this ERP. |
| Consortial shared catalog | **Partly (done)** | `library_branch_institutions` lets one branch serve several institutions. |
| OPAC/discovery for patrons | **Yes (new)** | Faculty/student catalog browse + my loans/holds. |
| Stock verification / inventory | **Yes (done)** | Shelf audit updates copy status/shelf. |
| Reports & exports | **Yes (improved)** | CSV exports; add acquisition/utilisation reports later. |

## Recommendation

**Do not adopt a third-party ILS.** Treat UniOs Library as a first-class, integrated
LMS that borrows the ILS *vocabulary and guardrails* (bib/copy split, accession
register, authority control, reviewed cataloguing, circulation rules) while staying
inside the ERP's identity, student and finance fabric. The three investments that
matter most:

1. **Onboarding at scale** — legacy register import must reliably become approved
   catalog copies. This is where production is currently stuck (8,207 rows, 1 approved).
2. **Trustworthy roles** — a librarian must be able to work the day they are created,
   without an admin pre-wiring branch assignments.
3. **Discovery + self-service** — faculty and students must search the catalog and
   manage their own loans/holds.

Phase 2 candidates, in order of value: acquisition/utilisation reports, serials,
Z39.50/SRU copy cataloguing, MARC export, and e-resource links.
