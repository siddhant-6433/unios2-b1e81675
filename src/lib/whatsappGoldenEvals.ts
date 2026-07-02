export interface WhatsAppGoldenAnswerEval {
  id: string;
  category: "fees" | "eligibility" | "course_not_offered" | "hostel" | "dnc" | "general";
  language: "en" | "hi" | "hinglish";
  candidateMessage: string;
  expectedAnswerNotes: string;
  requiredTerms: string[];
  forbiddenTerms: string[];
  sourceRefs: string[];
}

export interface WhatsAppGoldenAnswerResult {
  id: string;
  passed: boolean;
  missingTerms: string[];
  forbiddenTermsFound: string[];
}

export const WHATSAPP_GOLDEN_ANSWER_EVALS: WhatsAppGoldenAnswerEval[] = [
  {
    id: "fee_bsc_nursing_en",
    category: "fees",
    language: "en",
    candidateMessage: "What is the fee structure for B.Sc Nursing?",
    expectedAnswerNotes: "Answer with B.Sc Nursing first-year fee, canonical fee page, and scholarship/loan context.",
    requiredTerms: ["B.Sc Nursing", "1,53,000", "https://nimt.ac.in/admissions/fees/"],
    forbiddenTerms: ["contact admissions for latest fee"],
    sourceRefs: ["fee_structures", "fee_structure_items", "web-chat-server/knowledge.ts"],
  },
  {
    id: "fee_unknown_course_hinglish",
    category: "fees",
    language: "hinglish",
    candidateMessage: "Fees kitni hai?",
    expectedAnswerNotes: "Share official fee page, ask course/campus, and include compact popular fee examples without inventing a course-specific fee.",
    requiredTerms: ["https://nimt.ac.in/admissions/fees/", "course", "campus"],
    forbiddenTerms: ["I do not know", "contact admissions only"],
    sourceRefs: ["fee_structures", "web-chat-server/knowledge.ts"],
  },
  {
    id: "eligibility_bpt_en",
    category: "eligibility",
    language: "en",
    candidateMessage: "Am I eligible for BPT after 12th PCB?",
    expectedAnswerNotes: "Use DB eligibility: 10+2 PCB/English, minimum marks, and CAHET counselling for UP 2026-27.",
    requiredTerms: ["BPT", "10+2", "PCB", "CAHET"],
    forbiddenTerms: ["NEET required"],
    sourceRefs: ["eligibility_rules", "courses.marketing_eligibility", "web-chat-server/knowledge.ts"],
  },
  {
    id: "course_not_offered_mbbs",
    category: "course_not_offered",
    language: "en",
    candidateMessage: "Do you have MBBS?",
    expectedAnswerNotes: "Clearly say MBBS is not currently offered and suggest healthcare alternatives.",
    requiredTerms: ["do not currently offer", "B.Sc Nursing", "BPT"],
    forbiddenTerms: ["MBBS admission is open"],
    sourceRefs: ["web-chat-server/knowledge.ts"],
  },
];

function normalizeForEval(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function evaluateWhatsAppGoldenAnswer(
  golden: WhatsAppGoldenAnswerEval,
  answer: string,
): WhatsAppGoldenAnswerResult {
  const normalizedAnswer = normalizeForEval(answer);
  const missingTerms = golden.requiredTerms.filter((term) =>
    !normalizedAnswer.includes(normalizeForEval(term))
  );
  const forbiddenTermsFound = golden.forbiddenTerms.filter((term) =>
    normalizedAnswer.includes(normalizeForEval(term))
  );

  return {
    id: golden.id,
    passed: missingTerms.length === 0 && forbiddenTermsFound.length === 0,
    missingTerms,
    forbiddenTermsFound,
  };
}

export function evaluateWhatsAppGoldenAnswers(
  answersById: Record<string, string>,
  evals: WhatsAppGoldenAnswerEval[] = WHATSAPP_GOLDEN_ANSWER_EVALS,
): WhatsAppGoldenAnswerResult[] {
  return evals.map((golden) => evaluateWhatsAppGoldenAnswer(golden, answersById[golden.id] || ""));
}
