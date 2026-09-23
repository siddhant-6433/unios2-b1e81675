import { describe, it, expect } from "vitest";
import {
  priorityRank,
  ticketStatusBadge,
  ticketPriorityBadge,
  announcementIsLive,
  announcementVisibleTo,
  announcementLifecycleRank,
  sortAnnouncements,
  PRIORITY_RANK,
  TICKET_CATEGORIES,
  type Announcement,
} from "./engagement";

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  id: over.id ?? "a1",
  title: "Title",
  body: "Body",
  audience_roles: null,
  institution_id: null,
  campus_id: null,
  is_pinned: false,
  published_at: "2026-01-01T00:00:00.000Z",
  expires_at: null,
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("priorityRank", () => {
  it("ranks urgent highest and low lowest", () => {
    expect(priorityRank("urgent")).toBeGreaterThan(priorityRank("high"));
    expect(priorityRank("high")).toBeGreaterThan(priorityRank("normal"));
    expect(priorityRank("normal")).toBeGreaterThan(priorityRank("low"));
  });

  it("matches the exported table", () => {
    expect(priorityRank("urgent")).toBe(PRIORITY_RANK.urgent);
    expect(priorityRank("low")).toBe(PRIORITY_RANK.low);
  });

  it("sinks unknown or missing values below low", () => {
    expect(priorityRank("nonsense")).toBeLessThan(priorityRank("low"));
    expect(priorityRank(null)).toBeLessThan(priorityRank("low"));
    expect(priorityRank(undefined)).toBeLessThan(priorityRank("low"));
  });
});

describe("ticketStatusBadge", () => {
  it("labels known statuses", () => {
    expect(ticketStatusBadge("open").label).toBe("Open");
    expect(ticketStatusBadge("in_progress").label).toBe("In progress");
    expect(ticketStatusBadge("resolved").label).toBe("Resolved");
    expect(ticketStatusBadge("closed").label).toBe("Closed");
  });

  it("humanises an unknown status instead of dropping it", () => {
    const badge = ticketStatusBadge("waiting_on_parts");
    expect(badge.label).toBe("waiting on parts");
    expect(badge.className).toContain("bg-muted");
  });

  it("handles null without throwing", () => {
    expect(ticketStatusBadge(null).label).toBe("Unknown");
  });

  it("gives every status a distinct label", () => {
    const labels = ["open", "in_progress", "resolved", "closed"].map((s) => ticketStatusBadge(s).label);
    expect(new Set(labels).size).toBe(4);
  });
});

describe("ticketPriorityBadge", () => {
  it("labels known priorities", () => {
    expect(ticketPriorityBadge("urgent").label).toBe("Urgent");
    expect(ticketPriorityBadge("normal").label).toBe("Normal");
  });

  it("marks urgent with the red pastel and low with muted", () => {
    expect(ticketPriorityBadge("urgent").className).toContain("bg-pastel-red");
    expect(ticketPriorityBadge("low").className).toContain("bg-muted");
  });

  it("falls back for unknown priorities", () => {
    const badge = ticketPriorityBadge("whenever");
    expect(badge.label).toBe("whenever");
    expect(badge.className).toContain("bg-muted");
  });
});

describe("announcementIsLive", () => {
  const now = "2026-06-01T12:00:00.000Z";

  it("is live when published in the past with no expiry", () => {
    expect(announcementIsLive(announcement({ published_at: "2026-05-01T00:00:00.000Z" }), now)).toBe(true);
  });

  it("is not live while still a draft", () => {
    expect(announcementIsLive(announcement({ published_at: null }), now)).toBe(false);
  });

  it("is not live when scheduled in the future", () => {
    expect(announcementIsLive(announcement({ published_at: "2026-07-01T00:00:00.000Z" }), now)).toBe(false);
  });

  it("is live exactly at the publish instant", () => {
    expect(announcementIsLive(announcement({ published_at: now }), now)).toBe(true);
  });

  it("is live while the expiry is in the future", () => {
    expect(
      announcementIsLive(announcement({ expires_at: "2026-06-02T00:00:00.000Z" }), now),
    ).toBe(true);
  });

  it("is not live once the expiry has passed", () => {
    expect(
      announcementIsLive(announcement({ expires_at: "2026-05-01T00:00:00.000Z" }), now),
    ).toBe(false);
  });

  it("treats the expiry instant as expired (exclusive)", () => {
    expect(announcementIsLive(announcement({ expires_at: now }), now)).toBe(false);
  });

  it("accepts a Date and a timestamp as `now`", () => {
    const a = announcement({ published_at: "2026-05-01T00:00:00.000Z" });
    expect(announcementIsLive(a, new Date(now))).toBe(true);
    expect(announcementIsLive(a, Date.parse(now))).toBe(true);
  });
});

describe("announcementVisibleTo", () => {
  it("broadcasts a null audience to everyone", () => {
    expect(announcementVisibleTo(announcement({ audience_roles: null }), "faculty")).toBe(true);
    expect(announcementVisibleTo(announcement({ audience_roles: null }), null)).toBe(true);
  });

  it("treats an empty audience as broadcast too", () => {
    expect(announcementVisibleTo(announcement({ audience_roles: [] }), "faculty")).toBe(true);
  });

  it("restricts to the listed roles", () => {
    const a = announcement({ audience_roles: ["faculty", "hr_executive"] });
    expect(announcementVisibleTo(a, "faculty")).toBe(true);
    expect(announcementVisibleTo(a, "accountant")).toBe(false);
  });

  it("hides a targeted announcement from a viewer with no role", () => {
    expect(announcementVisibleTo(announcement({ audience_roles: ["faculty"] }), null)).toBe(false);
  });
});

describe("sortAnnouncements", () => {
  const now = "2026-06-01T12:00:00.000Z";

  it("buckets lifecycle: live, draft, scheduled, expired", () => {
    expect(announcementLifecycleRank(announcement({ published_at: "2026-05-30T00:00:00.000Z" }), now)).toBe(0);
    expect(announcementLifecycleRank(announcement({ published_at: null }), now)).toBe(1);
    expect(announcementLifecycleRank(announcement({ published_at: "2026-07-01T00:00:00.000Z" }), now)).toBe(2);
    expect(
      announcementLifecycleRank(
        announcement({ published_at: "2026-04-01T00:00:00.000Z", expires_at: "2026-05-01T00:00:00.000Z" }),
        now,
      ),
    ).toBe(3);
  });

  it("puts pinned announcements first", () => {
    const result = sortAnnouncements(
      [
        announcement({ id: "live", published_at: "2026-05-30T00:00:00.000Z" }),
        announcement({ id: "pinned", is_pinned: true, published_at: "2026-05-01T00:00:00.000Z" }),
      ],
      now,
    );
    expect(result.map((a) => a.id)).toEqual(["pinned", "live"]);
  });

  it("orders live ahead of drafts and expired", () => {
    const result = sortAnnouncements(
      [
        announcement({ id: "draft", published_at: null }),
        announcement({ id: "expired", published_at: "2026-04-01T00:00:00.000Z", expires_at: "2026-05-01T00:00:00.000Z" }),
        announcement({ id: "live", published_at: "2026-05-30T00:00:00.000Z" }),
      ],
      now,
    );
    expect(result.map((a) => a.id)).toEqual(["live", "draft", "expired"]);
  });

  it("orders within a group by effective date, newest first", () => {
    const result = sortAnnouncements(
      [
        announcement({ id: "old", published_at: "2026-05-01T00:00:00.000Z" }),
        announcement({ id: "new", published_at: "2026-05-30T00:00:00.000Z" }),
        announcement({ id: "mid", published_at: "2026-05-15T00:00:00.000Z" }),
      ],
      now,
    );
    expect(result.map((a) => a.id)).toEqual(["new", "mid", "old"]);
  });

  it("uses created_at when a draft has no published_at", () => {
    const result = sortAnnouncements(
      [
        announcement({ id: "older-draft", published_at: null, created_at: "2026-01-01T00:00:00.000Z" }),
        announcement({ id: "newer-draft", published_at: null, created_at: "2026-02-01T00:00:00.000Z" }),
      ],
      now,
    );
    expect(result.map((a) => a.id)).toEqual(["newer-draft", "older-draft"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      announcement({ id: "b", published_at: "2026-05-01T00:00:00.000Z" }),
      announcement({ id: "a", published_at: "2026-05-30T00:00:00.000Z" }),
    ];
    const before = input.map((a) => a.id);
    sortAnnouncements(input, now);
    expect(input.map((a) => a.id)).toEqual(before);
  });
});

describe("TICKET_CATEGORIES", () => {
  it("covers the categories the DB enum allows", () => {
    const values = TICKET_CATEGORIES.map((c) => c.value);
    expect(values).toEqual([
      "general", "payroll", "attendance", "leave", "documents", "it", "facilities", "grievance",
    ]);
  });
});
