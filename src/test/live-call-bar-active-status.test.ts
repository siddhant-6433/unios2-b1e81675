import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveCallBar = readFileSync("src/components/layout/LiveCallBar.tsx", "utf8");

/**
 * The voice agent flips a connected bridge call to status='in_progress' when
 * the student answers. The navbar used to query only 'initiated', so a call
 * vanished from the bar the moment it connected.
 */
describe("LiveCallBar active-status query", () => {
  it("keeps connected (in_progress) calls visible", () => {
    expect(liveCallBar).toContain('.in("status", ["initiated", "in_progress"])');
    expect(liveCallBar).not.toContain('.eq("status", "initiated")');
  });

  it("still treats live rows as non-terminal when finding terminal siblings", () => {
    expect(liveCallBar).toContain('.neq("status", "initiated")');
    expect(liveCallBar).toContain('.neq("status", "in_progress")');
  });
});
