import { describe, expect, it } from "vitest";
// The real resolver the edge functions use. Its Deno.env reads are all inside
// functions, so importing it under Node and exercising the data-driven path is
// safe (and is the whole point: assert the actual routing decision).
import { resolveWhatsAppChannel } from "../../supabase/functions/_shared/whatsapp-channel.ts";

// Production channels, trimmed to the ones that matter for routing.
const CHANNELS = [
  {
    id: "adm-default", label: "Admissions default Meta sender", provider: "meta",
    route: "admissions", business_number: null, meta_phone_number_id: null,
    secret_token_name: null, waba_id: null,
    allow_ai: true, allow_manual_reply: true, allow_bulk: false,
  },
  {
    id: "mirai", label: "Mirai Experiential School sender 9220522282", provider: "meta",
    route: "reply", business_number: "919220522282", meta_phone_number_id: "1110238142172240",
    secret_token_name: "WHATSAPP_API_TOKEN", waba_id: "34722980423984295",
    allow_ai: true, allow_manual_reply: true, allow_bulk: true,
  },
  {
    id: "seralis-lab", label: "Seralis Lab sender 9220522281", provider: "meta",
    route: "reply", business_number: "919220522281", meta_phone_number_id: "762544046936970",
    secret_token_name: "WHATSAPP_SERALIS_API_TOKEN", waba_id: "1303502464451428",
    allow_ai: false, allow_manual_reply: true, allow_bulk: true,
  },
];

const fakeAdmin = (rows: unknown[]) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  }) as any;

describe("resolveWhatsAppChannel WABA routing", () => {
  it("sends a Mirai-WABA template from the Mirai number, not the default", async () => {
    const ch = await resolveWhatsAppChannel(fakeAdmin(CHANNELS), {
      route: "admissions",
      wabaId: "34722980423984295",
    });
    expect(ch.id).toBe("mirai");
    expect(ch.meta_phone_number_id).toBe("1110238142172240");
  });

  it("keeps default-WABA templates on the admissions sender", async () => {
    const ch = await resolveWhatsAppChannel(fakeAdmin(CHANNELS), {
      route: "admissions",
      wabaId: null,
    });
    expect(ch.id).toBe("adm-default");
  });

  it("routes each non-default WABA to its own sender", async () => {
    const ch = await resolveWhatsAppChannel(fakeAdmin(CHANNELS), {
      route: "reply",
      wabaId: "1303502464451428",
    });
    expect(ch.id).toBe("seralis-lab");
    expect(ch.meta_phone_number_id).toBe("762544046936970");
  });
});
