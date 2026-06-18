import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordCallDisposition, type RecordCallDispositionArgs } from "./callDisposition";
import type { CallDispositionData } from "@/components/admissions/CallDispositionDialog";

/**
 * Regression tests for the disposition-save performance fix.
 *
 * The bug: saving a disposition from the lead page was slow because the pipeline
 * awaited ~8 dependent Supabase round-trips in series (each amplified by per-row
 * can_view_lead RLS) and the two WhatsApp getSession() lookups sat on the
 * critical path even though the sends are fire-and-forget.
 *
 * The fix collapses every write into ONE `record_disposition_writes` RPC call,
 * with the client resolving the stage target / wording / follow-up and passing
 * them in. These tests pin:
 *   1. A single RPC carries the correctly-resolved disposition payload.
 *   2. A WhatsApp session lookup that never resolves does NOT block the save.
 *   3. A hard RPC error is surfaced (not reported as a successful save).
 */

interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

function makeMockSupabase(opts?: { getSession?: () => Promise<unknown>; rpcError?: unknown; rpcErrors?: unknown[] }) {
  const rpcCalls: RpcCall[] = [];

  const client = {
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      const error = opts?.rpcErrors ? opts.rpcErrors[rpcCalls.length - 1] ?? null : opts?.rpcError ?? null;
      return Promise.resolve({ data: "call-log-1", error });
    },
    auth: {
      getSession:
        opts?.getSession ??
        (async () => ({ data: { session: { access_token: "test-token" } } })),
    },
  };

  return { client: client as unknown as RecordCallDispositionArgs["supabase"], rpcCalls };
}

const baseArgs = (
  data: CallDispositionData,
  supabase: RecordCallDispositionArgs["supabase"],
): RecordCallDispositionArgs => ({
  supabase,
  leadId: "lead-1",
  lead: { name: "Asha", phone: "+910000000000", stage: "new_lead" },
  userId: "user-1",
  profileId: "profile-1",
  courseName: "B.Tech CSE",
  data,
  loggedFromLabel: "lead page",
  callUuid: "call-uuid-1", // explicit so the test never depends on crypto.randomUUID
  callSource: "manual_log",
});

const interestedNoFollowup: CallDispositionData = {
  disposition: "interested",
  duration_seconds: 120,
  notes: "Keen on CSE",
  schedule_followup: false,
  suppress_auto_whatsapp: true, // keep WhatsApp out of the core-write tests
  send_course_info: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recordCallDisposition — single consolidated RPC", () => {
  it("issues exactly one record_disposition_writes call with the resolved payload", async () => {
    // Arrange
    const { client, rpcCalls } = makeMockSupabase();

    // Act
    await recordCallDisposition(baseArgs(interestedNoFollowup, client));

    // Assert — one RPC, carrying the client-resolved values.
    expect(rpcCalls).toHaveLength(1);
    const { name, params } = rpcCalls[0];
    expect(name).toBe("record_disposition_writes");
    expect(params.p_lead_id).toBe("lead-1");
    expect(params.p_call_uuid).toBe("call-uuid-1");
    expect(params.p_call_source).toBe("manual_log");
    expect(params.p_call_activity_desc).toContain("Interested");
    // new_lead → counsellor_call auto-advances, so the stage params are set.
    expect(params.p_new_stage).toBe("counsellor_call");
    expect(params.p_stage_activity_desc).toContain("auto-advanced");
    // No follow-up was scheduled.
    expect(params.p_followup_at).toBeNull();
  });

  it("passes follow-up params when one is scheduled", async () => {
    // Arrange
    const { client, rpcCalls } = makeMockSupabase();
    const data: CallDispositionData = {
      disposition: "call_back",
      duration_seconds: 60,
      notes: "",
      schedule_followup: true,
      followup_date: "2026-06-05T10:00:00.000Z",
      suppress_auto_whatsapp: true,
      send_course_info: false,
    };

    // Act
    await recordCallDisposition(baseArgs(data, client));

    // Assert
    const { params } = rpcCalls[0];
    expect(params.p_followup_at).toBe("2026-06-05T10:00:00.000Z");
    expect(params.p_followup_notes).toContain("Follow-up after");
    expect(params.p_followup_activity_desc).toContain("Follow-up scheduled");
  });

  it("passes the B.Sc Nursing CNET appeared answer when captured", async () => {
    const { client, rpcCalls } = makeMockSupabase();
    const data: CallDispositionData = {
      ...interestedNoFollowup,
      cnet_appeared: false,
    };

    await recordCallDisposition(baseArgs(data, client));

    expect(rpcCalls[0].params.p_cnet_appeared).toBe(false);
  });

  it("passes the BPT/BMRIT CAHET registered answer when captured", async () => {
    const { client, rpcCalls } = makeMockSupabase();
    const data: CallDispositionData = {
      ...interestedNoFollowup,
      cahet_registered: true,
    };

    await recordCallDisposition(baseArgs(data, client));

    expect(rpcCalls[0].params.p_cahet_registered).toBe(true);
  });

  it("retries the legacy RPC signature when the deployed DB lacks qualifier params", async () => {
    const { client, rpcCalls } = makeMockSupabase({
      rpcErrors: [{ code: "PGRST202", message: "Could not find the function public.record_disposition_writes(p_cahet_registered, p_cnet_appeared)" }, null],
    });

    await recordCallDisposition(baseArgs(interestedNoFollowup, client));

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].params).toHaveProperty("p_cnet_appeared");
    expect(rpcCalls[0].params).toHaveProperty("p_cahet_registered");
    expect(rpcCalls[1].params).not.toHaveProperty("p_cnet_appeared");
    expect(rpcCalls[1].params).not.toHaveProperty("p_cahet_registered");
    expect(rpcCalls[1].params.p_followup_at).toBeNull();
  });

  it("resolves the deferred stage + future session for an ineligible-but-future lead", async () => {
    // Arrange
    const { client, rpcCalls } = makeMockSupabase();
    const data: CallDispositionData = {
      disposition: "ineligible",
      duration_seconds: 90,
      notes: "",
      schedule_followup: false,
      future_eligible_session: "2027-28",
      suppress_auto_whatsapp: true,
      send_course_info: false,
    };

    // Act
    await recordCallDisposition(baseArgs(data, client));

    // Assert
    const { params } = rpcCalls[0];
    expect(params.p_new_stage).toBe("deferred");
    expect(params.p_future_eligible_session).toBe("2027-28");
    expect(params.p_stage_activity_desc).toContain("Deferred");
  });
});

describe("recordCallDisposition — WhatsApp is off the critical path", () => {
  it("resolves even when the session lookup for WhatsApp never resolves", async () => {
    // Arrange — getSession hangs forever. If the save awaited it (the old bug),
    // this test would time out instead of passing.
    const neverResolves = () => new Promise<unknown>(() => {});
    const { client, rpcCalls } = makeMockSupabase({ getSession: neverResolves });
    const data: CallDispositionData = {
      ...interestedNoFollowup,
      suppress_auto_whatsapp: false, // trigger an auto WhatsApp send
    };

    // Act + Assert — completes without waiting on the hung session lookup.
    await expect(recordCallDisposition(baseArgs(data, client))).resolves.toBeUndefined();
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("recordCallDisposition — hard failures surface", () => {
  it("throws when the RPC returns an error", async () => {
    // Arrange
    const { client } = makeMockSupabase({ rpcError: { message: "boom" } });

    // Act + Assert
    await expect(recordCallDisposition(baseArgs(interestedNoFollowup, client))).rejects.toBeTruthy();
  });
});

describe("recordCallDisposition — stage resolution per disposition", () => {
  const makeData = (over: Partial<CallDispositionData>): CallDispositionData => ({
    disposition: "interested",
    duration_seconds: 0,
    notes: "",
    schedule_followup: false,
    suppress_auto_whatsapp: true,
    send_course_info: false,
    ...over,
  });

  const cases: Array<{ name: string; data: Partial<CallDispositionData>; expectedStage: string | null }> = [
    { name: "not_interested → not_interested", data: { disposition: "not_interested" }, expectedStage: "not_interested" },
    { name: "do_not_contact → dnc", data: { disposition: "do_not_contact" }, expectedStage: "dnc" },
    { name: "ineligible without future session → ineligible", data: { disposition: "ineligible" }, expectedStage: "ineligible" },
    { name: "voicemail → no stage change (null)", data: { disposition: "voicemail" }, expectedStage: null },
    { name: "wrong_number → no stage change (null)", data: { disposition: "wrong_number" }, expectedStage: null },
  ];

  for (const c of cases) {
    it(`resolves ${c.name}`, async () => {
      // Arrange
      const { client, rpcCalls } = makeMockSupabase();

      // Act
      await recordCallDisposition(baseArgs(makeData(c.data), client));

      // Assert
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0].params.p_new_stage).toBe(c.expectedStage);
    });
  }
});

describe("dispatchDispositionWhatsApp — template selection", () => {
  const bodies = () => fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));

  const makeData = (over: Partial<CallDispositionData>): CallDispositionData => ({
    disposition: "interested",
    duration_seconds: 0,
    notes: "",
    schedule_followup: false,
    suppress_auto_whatsapp: false,
    send_course_info: false,
    ...over,
  });

  it("sends nimt_followup_v2 for interested", async () => {
    const { client } = makeMockSupabase();
    await recordCallDisposition(baseArgs(makeData({ disposition: "interested" }), client));
    await flushMicrotasks();
    expect(bodies().map((b) => b.template_key)).toContain("nimt_followup_v2");
  });

  it("sends missed_call for not_answered", async () => {
    const { client } = makeMockSupabase();
    await recordCallDisposition(baseArgs(makeData({ disposition: "not_answered" }), client));
    await flushMicrotasks();
    expect(bodies().map((b) => b.template_key)).toContain("missed_call");
  });

  it("sends nimt_not_interested_ack for not_interested", async () => {
    const { client } = makeMockSupabase();
    await recordCallDisposition(baseArgs(makeData({ disposition: "not_interested" }), client));
    await flushMicrotasks();
    expect(bodies().map((b) => b.template_key)).toContain("nimt_not_interested_ack");
  });

  it("also sends course_info_v4 when send_course_info is set", async () => {
    const { client } = makeMockSupabase();
    await recordCallDisposition(baseArgs(makeData({ disposition: "interested", send_course_info: true }), client));
    await flushMicrotasks();
    expect(bodies().map((b) => b.template_key)).toEqual(
      expect.arrayContaining(["nimt_followup_v2", "course_info_v4"]),
    );
  });

  it("sends nothing when suppressed and no course info", async () => {
    const { client } = makeMockSupabase();
    await recordCallDisposition(baseArgs(makeData({ disposition: "interested", suppress_auto_whatsapp: true }), client));
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the lead has no phone", async () => {
    const { client } = makeMockSupabase();
    const args = { ...baseArgs(makeData({ disposition: "interested" }), client), lead: { name: "Asha", phone: null, stage: "new_lead" } };
    await recordCallDisposition(args);
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
