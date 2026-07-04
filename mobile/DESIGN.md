# NIMT Mobile Design System — "Warm Editorial Utility"

Source of truth for both app variants: **NIMT Campus** (parent/student) and **NIMT Staff**.
Locked from user references (2026-07): Voiceon dashboard, Aster capacity UI, mobile ticket
cards, bid-status table, upload states, Figura dark reminders, dark editorial hero,
portfolio finance app, audiobook editor — plus the live UniOs web dashboard, which already
speaks this language (soft-tint chips, pipeline stat cards, lifecycle steppers).

All values live in `theme/tokens.ts`. Screens never hardcode colors or spacing.

---

## 1. Surfaces

| Token | Light | Dark |
|---|---|---|
| `canvas` | `#F7F5F2` warm off-white | `#0D0D0F` near-black |
| `card` | `#FFFFFF` | `#1A1A1E` elevated charcoal |
| `cardSubtle` | `#FBFAF8` | `#141416` |
| `inverse` | `#17161A` (dark hero panel) | `#F7F5F2` |

- Cards use **large radii** (16–20) and hairline-free separation: elevation + background
  contrast, almost no borders. When a border is unavoidable use `line` (`#EFEDE9` / `#26262B`).
- Dark mode is a first-class theme (Figura reference): charcoal cards on near-black,
  **not** inverted grays.

## 2. Ink & accent

| Token | Light | Dark |
|---|---|---|
| `ink` | `#1A1917` | `#F4F3F1` |
| `inkSecondary` | `#6E6A64` | `#A7A4A0` |
| `inkMuted` | `#A6A19A` | `#6B6965` |
| `accent` | `#0035C5` NIMT indigo | `#7B96FF` |

Accent is **semantic, not decorative** — links, active states, inline-emphasis words.
Primary CTAs are **black pills** (`ink` background), one per screen. Secondary = white/outline pill.
Floating contextual actions over lists = black pill, centered ("Sort by" reference).

## 3. Chip tints — the signature atom

Soft tinted background + saturated foreground, always with a leading icon.
Usage is semantic and consistent across both apps:

| Tint | Light bg / fg | Meaning |
|---|---|---|
| `yellow` | `#FBF3D7` / `#8A6100` | location, campus, hostel |
| `blue` | `#E4ECFB` / `#1D4FD7` | course, batch, team, info |
| `purple` | `#EFE8FC` / `#6D28D9` | duration, time window |
| `red` | `#FBE3E1` / `#C0392B` | due, SLA, overdue, absent |
| `green` | `#DFF3E5` / `#187741` | paid, present, approved |
| `orange` | `#FBEBDB` / `#B45309` | pending, in-transit |
| `neutral` | `#F1EFEC` / `#57534E` | ids, misc metadata |

**Status pills** are chips with state icons — green ✓ Approved, blue 👁 In review,
yellow ⟳ Pending (spinner), red ✕ Rejected. Statuses are never plain text.

## 4. Typography

- Workhorse: system sans (SF/Roboto) now; upgrade path = Inter via `expo-font`.
- Display: greeting headlines at 28–34, `-0.5` tracking, weight 700.
- **Inline emphasis** pattern (Figura/Lukas references): muted base text with key
  numbers/words in `ink` (or `accent`) — "You have **2 approvals** and **3 classes** today".
- Serif-italic accent word in display headlines (Voiceon "Welcome, *Alex*"): Georgia/serif italic.
- **Money & metrics**: big numerals (28–40), `fontVariant: ['tabular-nums']`, tight tracking.
- Scale: display 32 / h1 24 / h2 20 / h3 16 / body 15 / caption 13 / micro 11.

## 5. Layout & navigation

- 4pt spacing grid (`spacing` tokens: 4/8/12/16/20/24/32).
- Bottom tab bar: 3–4 items max, filled/outline icon swap, no top border in dark mode.
- Large-title headers that collapse on scroll; edge-to-edge with safe-area respect.
- Segmented pill controls for scope switching (Today/Week, child switcher) — active segment
  = ink pill with white text (Aster reference).
- **Bento home dashboards**: mixed-size stat tiles, not uniform card lists.

## 6. Signature components (in `components/ui/`)

| Component | Reference | Use |
|---|---|---|
| `GreetingHero` | Figura/Lukas dark hero | Me/Home greeting with inline-emphasis stats; staff variant renders on `inverse` panel |
| `Chip` / `StatusPill` | ticket card, bid table | metadata + status everywhere |
| `TickBar` | Aster capacity, upload progress | segmented vertical-bar progress: attendance %, fee completion, occupancy |
| `ApprovalCard` | ticket card | Inbox actionable card: title, 2-line context, chip row, approve/reject |
| `StatTile` | portfolio app, web pipeline cards | bento tiles with big numerals |
| `PassCard` | wallet passes | gatepass QR pass: photo, validity chips, full-screen |
| `Skeleton` | — | loading states; spinners only inside status pills |
| `EmptyState` | — | friendly illustrated empties |

## 7. Motion & feel

- `react-native-reanimated`: press-scale (0.97) on all pressables, count-up numerals,
  soft slide/fade screen transitions. Respect reduce-motion.
- Haptics (`expo-haptics`): punch in/out, approval decisions, scan success, payment success.
- Celebratory moments in Campus (fee paid, gatepass approved): scale-in check + haptic.

## 8. Two personalities, one DNA

| | NIMT Campus | NIMT Staff |
|---|---|---|
| Feel | warm, roomy, celebratory | dense, data-forward |
| Home | light bento dashboard | dark editorial hero over white sheet |
| Chips | more color allowed | stricter semantic use |
| Type | larger, friendlier | tighter list rhythm |

Both ship light + dark; theme follows the OS.

## 9. Accessibility

- Tint pairs meet WCAG AA contrast; 44pt minimum touch targets; dynamic type respected;
  every actionable card has `accessibilityRole`/`Label`; reduce-motion honored.
