import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260713200000_photo_day_async_pipeline.sql",
  "utf8",
);
const capture = readFileSync("supabase/functions/student-photo-capture/index.ts", "utf8");
const worker = readFileSync("supabase/functions/process-student-photo-jobs/index.ts", "utf8");
const shared = readFileSync("supabase/functions/_shared/passportPhoto.ts", "utf8");

describe("Photo Day async pipeline", () => {
  it("registers assignable photo_day permissions for principal and super_admin", () => {
    expect(migration).toContain("photo_day");
    expect(migration).toContain("'capture'");
    expect(migration).toContain("'assign'");
    expect(migration).toContain("assign_photo_day");
    expect(migration).toContain("can_capture_student_photos");
    expect(migration).toContain("can_assign_photo_day");
    expect(migration).toContain("'principal'");
    expect(migration).toContain("'super_admin'");
  });

  it("stores original + processed columns and a job queue", () => {
    expect(migration).toContain("photo_original_url");
    expect(migration).toContain("photo_processed_url");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.student_photo_jobs");
    expect(migration).toContain("claim_student_photo_jobs");
    expect(migration).toContain("cancel_pending_student_photo_jobs");
    expect(migration).toContain("process-student-photo-jobs");
  });

  it("capture path never waits on Gemini — original first then enqueue", () => {
    expect(capture).toContain("student-photo-capture");
    expect(capture).toContain("can_capture_student_photos");
    expect(capture).toContain("photo_original_url");
    expect(capture).toContain("photo_url: originalUrl");
    expect(capture).toContain("student_photo_jobs");
    expect(capture).not.toContain("processPassportPhoto");
    expect(capture).toContain("process-student-photo-jobs");
  });

  it("worker auto-flips photo_url to processed on success", () => {
    expect(worker).toContain("processPassportPhoto");
    expect(worker).toContain("photo_processed_url");
    expect(worker).toContain("photo_url: processedUrl");
    expect(worker).toContain("claim_student_photo_jobs");
    expect(worker).toContain("photo_original_url");
  });

  it("shares a single Gemini passport helper", () => {
    expect(shared).toContain("PASSPORT_PHOTO_PROMPT");
    expect(shared).toContain("processPassportPhoto");
    expect(shared).toContain("pure-white");
  });
});
