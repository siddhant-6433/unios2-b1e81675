import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const listIndexMigration = readMigration("whatsapp_inbox_list_from_conversation_state");

describe("WhatsApp inbox speed — chat index + lazy thread", () => {
  it("lists conversations from whatsapp_conversation_state, not a DISTINCT ON of messages", () => {
    expect(listIndexMigration).toContain("FROM public.whatsapp_conversation_state s");
    expect(listIndexMigration).toContain("trg_whatsapp_messages_touch_conversation_state");
    expect(listIndexMigration).toContain("ADD COLUMN IF NOT EXISTS last_message text");
    expect(listIndexMigration).toContain("ADD COLUMN IF NOT EXISTS unreplied_count");
    expect(listIndexMigration).toContain("idx_wcs_list_last_message");
    expect(listIndexMigration).toContain("p_has_inbound boolean DEFAULT NULL");
    expect(listIndexMigration).toContain("idx_wcs_list_has_inbound");
    expect(inbox).toContain("p_has_inbound: isOutboundMode ? false : true");
    expect(inbox).toContain('rpc("whatsapp_conversations_page"');
    expect(inbox).not.toContain(".limit(5000)");
  });

  it("discovers inbox channels from the conversation index", () => {
    expect(inbox).toContain('rpc("whatsapp_inbox_channel_keys"');
    expect(listIndexMigration).toContain("CREATE OR REPLACE FUNCTION public.whatsapp_inbox_channel_keys()");
    expect(listIndexMigration).toContain("GROUP BY s.last_business_phone_number_id");
  });

  it("loads the newest thread page and prepends older messages on scroll-up", () => {
    expect(inbox).toContain("THREAD_PAGE_SIZE = 50");
    expect(inbox).toContain("Load earlier messages");
    expect(inbox).toContain("loadOlderMessages");
    expect(inbox).toContain(".order(\"created_at\", { ascending: false })");
    expect(inbox).toContain(".limit(THREAD_PAGE_SIZE)");
    expect(inbox).toContain("stickThreadToBottomRef");
    expect(inbox).not.toContain(".limit(200)");
  });

  it("polls the chat-index page instead of scanning recent messages globally", () => {
    expect(inbox).toContain("const tickNew");
    expect(inbox).toContain("const tickStatus");
    expect(inbox).toContain("mergeConversationIndexPage");
    expect(inbox).toContain("if (isCampaignEngagedInbox) return");
    expect(listIndexMigration).toContain("idx_wa_messages_phone_created_at");
    expect(inbox).not.toContain(".gte(\"created_at\", from)");
  });

  it("skips offscreen conversation-row layout work", () => {
    expect(inbox).toContain("[content-visibility:auto]");
    expect(inbox).toContain("[contain-intrinsic-size:auto_72px]");
    expect(inbox).toContain("[contain-intrinsic-size:auto_64px]");
  });

  it("counts category chips from conversation_state, not DISTINCT ON messages", () => {
    const categoryCountsMigration = readMigration("whatsapp_inbox_category_counts_from_conversation_state");
    expect(categoryCountsMigration).toContain("CREATE OR REPLACE FUNCTION public.whatsapp_inbox_category_counts");
    expect(categoryCountsMigration).toContain("FROM public.whatsapp_conversation_state s");
    expect(categoryCountsMigration).toContain("COALESCE(s.unreplied_count, 0)");
    expect(categoryCountsMigration).not.toContain("FROM public.whatsapp_messages wm");
    expect(categoryCountsMigration).not.toMatch(/SELECT\s+DISTINCT ON/i);
    expect(inbox).toContain('rpc as any)("whatsapp_inbox_category_counts"');
  });

  it("paints a cached thread immediately and does not await mark-read", () => {
    const categoryCountsMigration = readMigration("whatsapp_inbox_category_counts_from_conversation_state");
    expect(inbox).toContain("threadCacheRef");
    expect(inbox).toContain("rememberThreadCache");
    expect(inbox).toContain("const cached = threadCacheRef.current.get(cacheKey)");
    expect(inbox).toContain('void (supabase.rpc as any)("mark_whatsapp_conversation_read"');
    expect(inbox).not.toContain("await (supabase.rpc as any)(\"mark_whatsapp_conversation_read\"");
    expect(categoryCountsMigration).toContain("SET unreplied_count = 0");
    expect(categoryCountsMigration).toContain("LIMIT 200");
  });

  it("defers chrome queries until the list RPC can run, and skips no-op polls", () => {
    expect(inbox).toContain("runWhenInboxIdle");
    expect(inbox).toContain("requestIdleCallback");
    expect(inbox).toContain("conversationIndexFingerprint");
    expect(inbox).toContain("return changed ? next : prev");
  });
});
