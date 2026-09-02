import { readFileSync, readdirSync } from "node:fs";

// The pre-commit hook restamps new migrations with the real commit time, so
// resolve by name suffix instead of pinning a timestamp that will change.
function readMigration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`migration *_${suffix}.sql not found`);
  return readFileSync(`${dir}/${file}`, "utf8");
}
import { describe, expect, it } from "vitest";
import {
  buildTemplateParams,
  paramSlotsFromComponents,
  templateUsesCourseFields,
} from "@/lib/whatsappTemplateCatalog";

const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const whatsAppPanel = readFileSync("src/components/layout/WhatsAppPanel.tsx", "utf8");
const sendDialog = readFileSync("src/components/leads/SendWhatsAppDialog.tsx", "utf8");
const leadTemplatesModule = readFileSync("src/components/leads/whatsappTemplates.ts", "utf8");
const whatsappSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const campaignSend = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const aiReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");
const routeHealth = readFileSync("supabase/functions/whatsapp-route-health/index.ts", "utf8");
const badgeCounts = readFileSync("src/lib/actionBadgeCounts.ts", "utf8");
const templateManager = readFileSync("src/pages/TemplateManager.tsx", "utf8");
const replyStateMigration = readMigration("whatsapp_reply_state_counts");
const templatesRlsMigration = readMigration("whatsapp_templates_staff_read_and_sync_cron");
const routeHealthCronMigration = readMigration("whatsapp_route_health_cron");
const courseParamsMigration = readMigration("whatsapp_course_info_params_by_course");
const mediaUrlMigration = readMigration("whatsapp_template_settings_media_url");

describe("template catalog", () => {
  const components = [
    {
      type: "BODY",
      text: "Hi {{1}}, your {{2}} fee of {{3}} is due.",
      example: { body_text: [["Riya", "B.Sc Nursing", "Rs 25,000"]] },
    },
  ];

  it("derives ordered slots with Meta's example values", () => {
    const slots = paramSlotsFromComponents("fee_reminder", components, 3);
    expect(slots.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(slots[0].name).toBe("student_name");
    expect(slots[0].example).toBe("Riya");
  });

  it("trusts placeholder_count over the body scan, in both directions", () => {
    // Meta is the authority: whatsapp-send validates the outgoing params against
    // this exact count, so building a longer array would guarantee a 132000.
    expect(paramSlotsFromComponents("unknown_tpl", components, 5)).toHaveLength(5);
    expect(paramSlotsFromComponents("unknown_tpl", components, 2)).toHaveLength(2);
  });

  it("falls back to the body scan when no count was synced", () => {
    expect(paramSlotsFromComponents("unknown_tpl", components, 0)).toHaveLength(3);
  });

  it("names unmapped slots positionally rather than guessing", () => {
    const noGreeting = [{ type: "BODY", text: "Seat for {{1}} confirmed at {{2}}." }];
    const slots = paramSlotsFromComponents("unmapped_template", noGreeting, 2);
    expect(slots.map((s) => s.name)).toEqual(["param_1", "param_2"]);
  });

  it("auto-names a greeting's first slot so the lead name fills itself", () => {
    const greeting = [{ type: "BODY", text: "Hi {{1}},\n\nYour merit list is out. Call {{2}}." }];
    const slots = paramSlotsFromComponents("cahet_merit_list", greeting, 2);
    expect(slots.map((s) => s.name)).toEqual(["student_name", "param_2"]);
    expect(buildTemplateParams({ paramSlots: slots }, { student_name: "Priyanshi" }).params[0])
      .toBe("Priyanshi");
  });

  it("does not guess when the placeholder is not a greeting", () => {
    const midSentence = [{ type: "BODY", text: "Your seat for {{1}} is confirmed." }];
    expect(paramSlotsFromComponents("x", midSentence, 1)[0].name).toBe("param_1");
  });

  it("reports unfilled slots instead of inventing values", () => {
    // The old buildParams closures substituted "the pending amount" / "the due
    // date", which shipped to students verbatim.
    // fee_reminder's slots are [student_name, amount, due_date].
    const slots = paramSlotsFromComponents("fee_reminder", components, 3);
    const built = buildTemplateParams({ paramSlots: slots }, { student_name: "Riya" });
    expect(built.params[0]).toBe("Riya");
    expect(built.missing.map((s) => s.name)).toEqual(["amount", "due_date"]);
    expect(built.params.join(" ")).not.toContain("pending");
  });

  it("fills from overrides and strips characters Meta rejects", () => {
    const slots = paramSlotsFromComponents("fee_reminder", components, 3);
    const built = buildTemplateParams(
      { paramSlots: slots },
      { student_name: "Riya" },
      { amount: "Rs 25,000\nplus tax", due_date: "30 Aug" },
    );
    expect(built.missing).toHaveLength(0);
    // Newlines/tabs in a body parameter are Meta error 131009.
    expect(built.params[1]).toBe("Rs 25,000 plus tax");
  });
});

describe("course-driven template fields", () => {
  it("recognises the slots a course can fill", () => {
    const slots = paramSlotsFromComponents("course_info_v4", [{ type: "BODY", text: "Hi {{1}} {{2}} {{3}} {{4}} {{5}} {{6}}" }], 6);
    expect(templateUsesCourseFields({ paramSlots: slots })).toBe(true);
    // A name-only template must not show a course dropdown.
    const greeting = paramSlotsFromComponents("cahet_merit_list", [{ type: "BODY", text: "Hi {{1}}," }], 1);
    expect(templateUsesCourseFields({ paramSlots: greeting })).toBe(false);
  });

  it("offers the course picker and resolver in the inbox", () => {
    expect(inbox).toContain("templateUsesCourseFields");
    expect(inbox).toContain("applyTemplateCourse");
    // Defaults to whatever the lead enquired about.
    expect(inbox).toContain("setTemplateCourseId((leadRow as any)?.course_id");
    expect(courseParamsMigration).toContain("fn_resolve_course_info_params_by_course");
    expect(courseParamsMigration).toMatch(/\bSECURITY\s+DEFINER\b/i);
  });
});

describe("media-header templates", () => {
  it("keeps the sendable URL on the settings row, not in a hardcoded map", () => {
    // Meta's own header_handle is rejected as a send link (131053), which is why
    // the Clinical Training / Placement Report looked unavailable.
    expect(mediaUrlMigration).toContain("ADD COLUMN IF NOT EXISTS media_url");
    expect(mediaUrlMigration).toContain("placement_report_download");
    expect(mediaUrlMigration).toContain("show_in_lead_picker = true");
  });

  it("sends the header from the catalog and refuses when it is missing", () => {
    expect(inbox).toContain("header_document_url");
    expect(inbox).toContain("Template needs a file");
    expect(whatsappSend).toContain("settingsMediaUrl");
    expect(whatsappSend).toContain("resolvedHeaderDocumentUrl");
  });

  it("rejects a Meta header handle pasted as the media URL", () => {
    expect(readFileSync("src/lib/publicMediaUrl.ts", "utf8")).toContain("classifyHeaderMediaUrl");
    expect(readFileSync("src/components/templates/WhatsAppTemplatePreviewBubble.tsx", "utf8"))
      .toContain("scontent\\.whatsapp\\.net|lookaside\\.fbsbx\\.com");
  });

  it("uses the saved Template Manager header file as the campaign send default", () => {
    const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
    const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
    expect(marketingPage).toContain("media_url");
    expect(marketingPage).toContain("waTemplateMediaUrlByKey");
    expect(leadLists).toContain("media_url");
    expect(leadLists).toContain("waTemplateMediaUrlByKey");
  });
});

describe("send-time parameter guard", () => {
  it("validates arity against Meta's placeholder_count before calling Graph", () => {
    expect(whatsappSend).toContain("Template param mismatch");
    expect(whatsappSend).toContain("placeholder_count");
    expect(whatsappSend).toMatch(/expected !== suppliedParamCount/);
  });

  it("rejects media-header templates sent with no header", () => {
    expect(whatsappSend).toContain("needs a ${headerFormat.toLowerCase()} header");
  });

  it("knows the consultant payout template zoho-books-poll sends", () => {
    // Previously absent from TEMPLATES, so every payout notification 400'd.
    expect(whatsappSend).toContain("consultant_payout_disbursed:");
  });
});

describe("campaign template map reconciliation", () => {
  it("uses Meta template names that actually exist", () => {
    // visit_confirmation / visit_reminder_24hr / course_details are internal
    // keys, not Meta names. Sending them verbatim failed with 132001.
    expect(campaignSend).toContain('visit_confirmation: { name: "visit_confirmed"');
    expect(campaignSend).toContain('visit_reminder_24hr: { name: "visit_reminder"');
    expect(campaignSend).toContain('course_details: { name: "inquiry_course_update"');
  });

  it("matches whatsapp-send's arity for shared keys", () => {
    expect(campaignSend).toContain(
      'lead_welcome: { name: "lead_welcome", params: ["student_name", "course_name", "lead_source"] }',
    );
  });
});

describe("AI outage visibility", () => {
  it("writes a failed message row when a dispatch fails", () => {
    // A failed AI send used to write nothing at all, so the Aug 2026 Gemini
    // billing 403 was invisible in the inbox for three days.
    expect(aiReply).toContain("recordAiFailureBubble");
    expect(aiReply).toContain('status: "failed"');
  });

  it("only flags one failure per inbound turn", () => {
    // The buffer worker retries every 2 minutes.
    expect(aiReply).toContain('.eq("template_key", "ai_auto_reply")');
    expect(aiReply).toContain('.gt("created_at", lastInbound.created_at)');
  });

  it("emails once per incident, not once per failure", () => {
    expect(routeHealth).toContain("route_alert_sent");
    expect(routeHealth).toContain("if (unhealthy === alerting) return verdict");
    expect(routeHealth).toContain("siddhant@nimt.ac.in");
  });

  it("surfaces the outage in the inbox", () => {
    expect(inbox).toContain("Auto-replies are not going out");
  });

  it("runs the watchdog on a schedule", () => {
    expect(routeHealthCronMigration).toContain("cron.schedule(");
    expect(routeHealthCronMigration).toContain("whatsapp-route-health");
  });
});

describe("reply-state counts", () => {
  it("counts conversations by reply state, scoped like the list query", () => {
    expect(replyStateMigration).toContain("s.direction = 'inbound'");
    expect(replyStateMigration).toContain("cl.counsellor_id = p_counsellor_id");
    expect(replyStateMigration).toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(replyStateMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) TO authenticated",
    );
  });

  it("drives both the header pill and the inbox chips from that one RPC", () => {
    expect(whatsAppPanel).toContain("fetchWhatsAppReplyStateCounts");
    expect(whatsAppPanel).toContain("need reply");
    expect(inbox).toContain("fetchWhatsAppReplyStateCounts");
    expect(inbox).toContain("Needs Reply");
    expect(inbox).toContain("Awaiting Them");
  });

  it("counts off whatsapp_messages, not the expensive conversations view", () => {
    // Aggregating over whatsapp_conversations takes 7.3s in production — right
    // on the 8s statement timeout — because the view builds a DISTINCT ON plus
    // three LATERALs for every conversation before anything is counted.
    expect(replyStateMigration).toContain("FROM public.whatsapp_messages wm");
    expect(replyStateMigration).not.toContain("FROM public.whatsapp_conversations");
    expect(replyStateMigration).toContain("idx_whatsapp_messages_conversation_key_created");
  });

  it("dedups the RPC behind the shared TTL wrapper", () => {
    // The header mounts on every page; three layout components calling an
    // ~1.2s aggregate simultaneously is what blew the timeout last time.
    expect(badgeCounts).toContain("fetchWhatsAppReplyStateCounts");
    expect(badgeCounts).toContain("replyStateInflight");
    expect(inbox).toContain("invalidateWhatsAppReplyStateCounts()");
  });

  it("marks unreplied rows independently of read state", () => {
    // Opening a thread clears unread_count for the whole conversation, so read
    // state alone made unanswered leads look done.
    expect(inbox).toContain("const isNeedsReply");
    expect(inbox).toContain("isNeedsReply(c)");
  });
});

describe("no fabricated template values", () => {
  it("stops pre-filling placeholder sentences as if they were real context", () => {
    expect(inbox).not.toMatch(/^\s*amount: "the pending amount"/m);
    expect(inbox).not.toMatch(/^\s*due_date: "the due date"/m);
    expect(inbox).not.toMatch(/^\s*visit_date: "the scheduled date"/m);
    expect(inbox).not.toMatch(/^\s*application_id: "N\/A"/m);
    // The per-key switch in handleSendTemplate that hardcoded those strings.
    expect(inbox).not.toMatch(/case "fee_reminder": params = /);
  });

  it("blocks the lead dialog send while required values are missing", () => {
    expect(sendDialog).toContain("missingSlots.length > 0");
    expect(sendDialog).toContain("buildTemplateParams");
  });

  it("reads the real approved list rather than only hardcoded arrays", () => {
    expect(inbox).toContain("loadWhatsAppTemplateCatalog");
    // The lead picker's catalogue loading lives in the extracted
    // whatsappTemplates module; the dialog consumes it via useWhatsAppTemplates.
    expect(leadTemplatesModule).toContain("loadWhatsAppTemplateCatalog");
    expect(leadTemplatesModule).not.toContain("row.placeholder_count === 0");
    expect(sendDialog).toContain("useWhatsAppTemplates");
    expect(templatesRlsMigration).toContain("Staff can read whatsapp_templates");
    expect(templatesRlsMigration).toContain("'counsellor'::public.app_role");
    expect(templatesRlsMigration).not.toContain("team_leader");
  });
});
