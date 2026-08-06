import { ThinkingOrb, type OrbState, type OrbSize } from "thinking-orbs";
import { cn } from "@/lib/utils";

/**
 * Thinking-orb loaders. Replaces spinning `Loader2` across the app.
 *
 * ── State vocabulary ──────────────────────────────────────────────────────
 * The library ships nine animations. We use six, on purpose — nine states that
 * don't map to nine distinguishable user-facing meanings is decoration. Pass
 * the state as a literal prop at each site; `grep -rn 'state="solving"'` is the
 * index (a lookup helper with one caller per key would just be a rename table).
 *
 *   working     generic mutation with no better verb — save, submit, update,
 *               delete. The page-load default.
 *   searching   reading a set — list/table fetch, search fields, filters,
 *               pagination.
 *   solving     computation & reconciliation: a correct answer is being
 *               DERIVED, not data fetched. Deliberately scarce — payment
 *               settlement matching, fee-ledger/concession computation, lead
 *               allocation, report-card generation, bulk-import validation.
 *   connecting  a third party is on the other end — Gemini/Navya, WhatsApp and
 *               email sends, call dial, payment-gateway redirect.
 *   composing   a document is being produced — PDF, offer letter, receipt,
 *               transfer certificate, export.
 *   listening   live audio — active call, voice notes.
 *   breathing   AI thinking. Exactly one home: the WhatsApp copilot panel.
 *   weaving, shaping — unused.
 *
 * ── Theme ─────────────────────────────────────────────────────────────────
 * The orb is monochrome ink on a transparent canvas and takes no color. It
 * resolves light-vs-dark ink by walking ancestors for a `dark`/`light` class,
 * falling back to `prefers-color-scheme`. `index.html` pins `class="light"` so
 * `auto` is correct everywhere; `ButtonOrb` re-anchors that per button.
 */

/** Centered orb + optional label, for full-view and section loading states. */
export function OrbLoader({
  state = "working",
  label,
  size = 64,
  className,
}: {
  state?: OrbState;
  label?: string;
  size?: OrbSize;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <ThinkingOrb state={state} size={size} aria-label={label ?? "Loading"} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

/**
 * In-button / inline-with-text orb. Three things it bakes in so no call site
 * has to get them right:
 *
 * - `onFilled` — the button paints a dark solid background (Button variant
 *   `default` | `destructive` | `pill`, or a raw <button> with bg-primary /
 *   bg-destructive / bg-success / bg-foreground). The orb then needs LIGHT ink,
 *   which the library spells `theme="dark"`. The wrapper span carries the class
 *   rather than passing `theme` so the resolution stays anchored below any
 *   future real dark mode. `.dark`/`.light` have no CSS rule in this project —
 *   they're markers only, so nothing leaks to siblings.
 * - `aria-hidden` — the library always sets role="img" + a per-state aria-label,
 *   so a bare orb inside a button reading "Saving…" would announce
 *   "Working… Saving…". The button's own text is the label.
 * - `display: contents` — keeps the canvas a direct flex child of the button so
 *   `buttonVariants`' base `gap-2` still spaces it. (Note `[&_svg]:size-4` does
 *   not match a <canvas>; the library sets a hard 20x20 inline instead.)
 */
export function ButtonOrb({
  state = "working",
  onFilled = false,
  className,
}: {
  state?: OrbState;
  onFilled?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("contents", onFilled ? "dark" : "light")}>
      <ThinkingOrb state={state} size={20} aria-hidden className={className} />
    </span>
  );
}

export { ThinkingOrb };
export type { OrbState, OrbSize };
