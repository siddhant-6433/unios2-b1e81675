/**
 * Course-name → search-term normalisation for the voice agent.
 *
 * The LLM (Navya) is told to spell course initialisms for pronunciation —
 * "L L B", "B.Sc.", "B B A" — and passes that spelled form straight into the
 * course tools. The `courses` table stores them contiguous ("Bachelor of Laws
 * (LLB)", "BSc Nursing"), so a raw `ilike.*L L B*` never matches. This turns a
 * spoken/spelled phrase into an ordered list of terms to try, most specific
 * first, so the first hit wins.
 */
export function courseSearchTerms(raw: string): string[] {
  const cleaned = String(raw || "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const terms: string[] = [cleaned];

  // "L L B three years" → "LLB three years": collapse runs of single letters
  // into the initialism the DB actually stores.
  const deSpaced = cleaned.replace(
    /\b[A-Za-z](?:\s+[A-Za-z])+\b/g,
    (m) => m.replace(/\s+/g, ""),
  );
  if (!terms.includes(deSpaced)) terms.push(deSpaced);

  // Leading initialism alone ("LLB" out of "LLB three years") — the most
  // reliable hit once filler like "three years" / "course" is dropped.
  const firstWord = deSpaced.split(/\s+/)[0] || "";
  if (firstWord.length >= 2 && !terms.includes(firstWord)) terms.push(firstWord);

  // Last meaningful word ("Nursing", "Pharmacy") as a final fallback.
  const lastWord = cleaned.split(/\s+/).filter(Boolean).pop() || "";
  if (lastWord.length >= 3 && !terms.includes(lastWord)) terms.push(lastWord);

  return terms;
}
