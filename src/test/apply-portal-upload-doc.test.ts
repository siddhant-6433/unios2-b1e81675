// Integration test for the apply-portal-upload-doc edge function.
//
// Hits the live Supabase project to assert the guard rails — the function is
// the chokepoint for anonymous applicant uploads once the lockdown migration
// (20260516180000_lock_anon_application_docs.sql) lands, so any regression
// here re-opens the same RLS gap that broke production on 2026-05-16.
//
// These tests deliberately do NOT exercise the happy path (a real upload)
// because that would require a known good (application_id, phone) pair and
// would pollute production storage. The guards cover what's load-bearing.
//
// Set SKIP_NETWORK_TESTS=1 to skip (e.g. in offline CI).

import { describe, it, expect } from "vitest";

const SUPABASE_URL = "https://deylhigsisuexszsmypq.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3Nzg0MDgsImV4cCI6MjA4ODM1NDQwOH0.z8YWiwxkdIU-9zQhXu0z1BGFKu-GAUDcLrdNMnFxYEY";

const FN_URL = `${SUPABASE_URL}/functions/v1/apply-portal-upload-doc`;

const skip = process.env.SKIP_NETWORK_TESTS === "1";

function makeForm(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

function tinyPdf(): Blob {
  // 4-byte stub is enough — MIME is what the function checks.
  return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
}

async function call(form: FormData) {
  return fetch(FN_URL, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: form,
  });
}

describe.skipIf(skip)("apply-portal-upload-doc guards", () => {
  it("rejects missing fields with 400", async () => {
    const res = await call(makeForm({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("rejects unknown doc_key with 400", async () => {
    const res = await call(
      makeForm({
        application_id: "APP-26-FAKE",
        phone: "+919999999999",
        doc_key: "evil_payload",
        file: new File([tinyPdf()], "x.pdf", { type: "application/pdf" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/doc_key/i);
  });

  it("rejects unsupported MIME with 415", async () => {
    const res = await call(
      makeForm({
        application_id: "APP-26-FAKE",
        phone: "+919999999999",
        doc_key: "class_10_marksheet",
        file: new File([new Blob(["#!/bin/sh"], { type: "application/x-sh" })], "x.sh", {
          type: "application/x-sh",
        }),
      }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects (application_id, phone) that doesn't match with 403", async () => {
    // Random app id + random phone — virtually guaranteed not to match.
    const res = await call(
      makeForm({
        application_id: `APP-26-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        phone: "+910000000000",
        doc_key: "class_10_marksheet",
        file: new File([tinyPdf()], "x.pdf", { type: "application/pdf" }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("rejects oversized files with 413", async () => {
    const big = new Uint8Array(6 * 1024 * 1024); // 6MB > 5MB cap
    const res = await call(
      makeForm({
        application_id: "APP-26-FAKE",
        phone: "+919999999999",
        doc_key: "class_10_marksheet",
        file: new File([big], "big.pdf", { type: "application/pdf" }),
      }),
    );
    expect(res.status).toBe(413);
  });
});
