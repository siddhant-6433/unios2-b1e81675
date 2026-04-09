import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Fix student auth accounts for Avantika II campus.
 *
 * Strategy:
 * - Group students by father_phone (same phone = siblings, share one account)
 * - For each family group, check if an auth user already exists with that phone/email
 * - If exists and correctly linked, skip
 * - If no correct auth user, create one
 * - Update student.user_id to point to the correct auth user
 * - Ensure profile + roles (student, parent) exist
 */

const CAMPUS_ID = "9bb6b4cc-c992-4af1-b9d3-384537a510c8";
const DEFAULT_PASSWORD = "Nimt@2026";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Fetch all students in Avantika II
    const { data: students } = await admin
      .from("students")
      .select("id, name, sr_number, email, phone, father_phone, father_name, mother_phone, mother_name, user_id")
      .eq("campus_id", CAMPUS_ID)
      .order("sr_number");

    if (!students?.length) {
      return json({ error: "No students found" }, 404);
    }

    // 2. Group by father_phone (family grouping)
    const families = new Map<string, typeof students>();
    for (const s of students) {
      const key = s.father_phone || s.phone || s.id; // fallback to unique id if no phone
      if (!families.has(key)) families.set(key, []);
      families.get(key)!.push(s);
    }

    // 3. Fetch all existing auth users to check by phone/email
    const { data: allUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const usersByPhone = new Map<string, any>();
    const usersByEmail = new Map<string, any>();
    for (const u of allUsers?.users || []) {
      if (u.phone) usersByPhone.set(u.phone.replace(/^\+/, ""), u);
      if (u.email) usersByEmail.set(u.email.toLowerCase(), u);
    }

    const results: any[] = [];
    let created = 0, relinked = 0, skipped = 0;

    for (const [familyPhone, siblings] of families) {
      const primary = siblings[0]; // first sibling is the primary
      const normalizedPhone = familyPhone.replace(/\D/g, "");
      const phone91 = normalizedPhone.startsWith("91") ? normalizedPhone : `91${normalizedPhone}`;

      // Determine the email for this family's auth account
      // Use the student's real email if it's a proper email, otherwise generate one
      const realEmail = primary.email && !primary.email.includes("@beacon.nimt.ac.in") && !primary.email.includes("support@nimt.ac.in")
        ? primary.email
        : null;
      const authEmail = realEmail || `guardian.sr${primary.sr_number}@beacon.nimt.ac.in`;

      // Check if a correct auth user already exists
      let authUser = usersByPhone.get(phone91) || usersByEmail.get(authEmail.toLowerCase());

      // Check if ALL siblings already point to this user
      if (authUser) {
        const allCorrect = siblings.every(s => s.user_id === authUser.id);
        if (allCorrect) {
          skipped += siblings.length;
          results.push({ family: familyPhone, students: siblings.map(s => s.sr_number), status: "ok_already" });
          continue;
        }
      }

      // Create auth user if doesn't exist
      if (!authUser) {
        const guardianName = primary.father_name || `Guardian of ${primary.name}`;
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: authEmail,
          phone: `+${phone91}`,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { display_name: guardianName, full_name: guardianName },
        });

        if (createErr) {
          // If email already taken, try to find that user
          if (createErr.message.includes("already been registered")) {
            const existing = usersByEmail.get(authEmail.toLowerCase());
            if (existing) {
              authUser = existing;
            } else {
              results.push({ family: familyPhone, students: siblings.map(s => s.sr_number), status: "error", error: createErr.message });
              continue;
            }
          } else {
            results.push({ family: familyPhone, students: siblings.map(s => s.sr_number), status: "error", error: createErr.message });
            continue;
          }
        } else {
          authUser = newUser.user;
          created++;
          // Register in lookup maps
          usersByPhone.set(phone91, authUser);
          usersByEmail.set(authEmail.toLowerCase(), authUser);
        }
      }

      // Upsert profile
      const guardianName = primary.father_name || `Guardian of ${primary.name}`;
      await admin.from("profiles").upsert({
        user_id: authUser.id,
        display_name: guardianName,
        phone: `+${phone91}`,
      }, { onConflict: "user_id" });

      // Ensure student + parent roles
      for (const role of ["student", "parent"]) {
        await admin.from("user_roles").upsert(
          { user_id: authUser.id, role },
          { onConflict: "user_id,role" }
        ).select(); // .select() to suppress errors on conflict
      }

      // Update all siblings to point to this auth user
      for (const s of siblings) {
        if (s.user_id !== authUser.id) {
          await admin.from("students").update({ user_id: authUser.id }).eq("id", s.id);
          relinked++;
        }
      }

      results.push({
        family: familyPhone,
        auth_user_id: authUser.id,
        auth_email: authUser.email,
        students: siblings.map(s => s.sr_number),
        status: "fixed",
      });
    }

    return json({
      total_students: students.length,
      families: families.size,
      created,
      relinked,
      skipped,
      details: results,
    });
  } catch (err: any) {
    console.error("Fix student accounts error:", err);
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
