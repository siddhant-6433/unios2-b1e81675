/**
 * Role-based access control test suite
 * Tests that each role gets the right permissions from get_user_permissions RPC
 * and verifies the routing logic mirrors what the frontend enforces.
 *
 * Run: node scripts/test-role-guards.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://deylhigsisuexszsmypq.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3Nzg0MDgsImV4cCI6MjA4ODM1NDQwOH0.z8YWiwxkdIU-9zQhXu0z1BGFKu-GAUDcLrdNMnFxYEY";

const TEST_USERS = [
  {
    email: "test-counsellor@unios.test",
    password: "TestPass123!",
    expectedRole: "counsellor",
    expectedPortal: "staff",
    mustHave: ["leads:view", "call_log:view", "students:view", "whatsapp:view"],
    mustNotHave: ["hr:view", "finance:view", "user_management:view", "analytics:view"],
  },
  {
    email: "test-campus-admin@unios.test",
    password: "TestPass123!",
    expectedRole: "campus_admin",
    expectedPortal: "staff",
    mustHave: [
      "leads:view",
      "call_log:view",
      "hr:view",
      "finance:view",
      "analytics:view",
    ],
    mustNotHave: ["user_management:view"],
  },
  {
    email: "test-student@unios.test",
    password: "TestPass123!",
    expectedRole: "student",
    expectedPortal: "/student",
    mustHave: [],
    mustNotHave: [],
  },
  {
    email: "test-parent@unios.test",
    password: "TestPass123!",
    expectedRole: "parent",
    expectedPortal: "/parent",
    mustHave: [],
    mustNotHave: [],
  },
];

const ROUTE_PERMISSION_MAP = {
  "/admissions":       { module: "leads",           action: "view" },
  "/call-log":         { module: "call_log",         action: "view" },
  "/hr":               { module: "hr",               action: "view" },
  "/finance":          { module: "finance",           action: "view" },
  "/admin":            { module: "user_management",  action: "view" },
  "/admission-analytics": { module: "analytics",     action: "view" },
  "/lead-allocation":  { module: "lead_allocation",  action: "view" },
  "/automation-rules": { module: "automation",       action: "view" },
  "/whatsapp-inbox":   { module: "whatsapp",         action: "view" },
};

let pass = 0;
let fail = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    fail++;
  }
}

async function testUser(user) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`USER: ${user.email} (expected role: ${user.expectedRole})`);
  console.log("─".repeat(60));

  const client = createClient(SUPABASE_URL, ANON_KEY);

  // 1. Sign in
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  assert(!authError, `Sign-in succeeds (${authError?.message ?? "ok"})`);
  if (authError) return;

  const userId = authData.user.id;

  // 2. Fetch role from user_roles
  const { data: roleRow, error: roleError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  assert(!roleError, `user_roles fetch succeeds`);
  assert(roleRow?.role === user.expectedRole, `role = '${roleRow?.role}' (expected '${user.expectedRole}')`);

  // 3. Portal routing logic (mirrors frontend)
  const role = roleRow?.role;
  let portalResult;
  if (role === "student") portalResult = "/student";
  else if (role === "parent") portalResult = "/parent";
  else if (role === null) portalResult = "/my-applications";
  else portalResult = "staff";

  assert(
    portalResult === user.expectedPortal,
    `routes to '${portalResult}' (expected '${user.expectedPortal}')`
  );

  // 4. For staff roles, check permissions via RPC
  if (user.expectedPortal === "staff") {
    const { data: permsData, error: permsError } = await client.rpc(
      "get_user_permissions",
      { _user_id: userId }
    );

    assert(!permsError, `get_user_permissions RPC succeeds (${permsError?.message ?? "ok"})`);

    const perms = new Set(permsData ?? []);

    for (const p of user.mustHave) {
      assert(perms.has(p), `has permission '${p}'`);
    }
    for (const p of user.mustNotHave) {
      assert(!perms.has(p), `blocked from permission '${p}'`);
    }

    // 5. Route access simulation
    console.log(`\n  Route access (✅=allowed ❌=blocked):`);
    for (const [route, { module, action }] of Object.entries(ROUTE_PERMISSION_MAP)) {
      const allowed = perms.has(`${module}:${action}`);
      const label = `  ${route.padEnd(24)} [${module}:${action}]`;
      if (allowed) {
        console.log(`  ✅ ${label}`);
      } else {
        console.log(`  🚫 ${label}  → /forbidden`);
      }
    }
  }

  await client.auth.signOut();
}

console.log("UniOs Role Guard Test Suite");
console.log("============================");
console.log(`Testing ${TEST_USERS.length} users against ${SUPABASE_URL}\n`);

for (const user of TEST_USERS) {
  await testUser(user);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log("═".repeat(60));
if (fail > 0) process.exit(1);
