import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // JWT is already verified by Supabase gateway — decode sub claim directly
    const jwt = authHeader.replace("Bearer ", "");
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const callerId: string | undefined = payload?.sub;

    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { email, display_name, phone, role, campus, password, publisher_id, publisher_source, team_ids, lookup, notify } = await req.json();
    // Whether to send the WhatsApp + email "login ready" notifications. Default on
    // (backward compatible) — callers pass notify:false to create silently.
    const sendNotify = notify !== false;

    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: "Email and role are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Authorization. Super_admin may invite any role (admin panel). HR staff with
    // hr:employees_edit may provision logins from the verify screen, but only for
    // non-privileged staff roles — never super_admin/campus_admin — so an HR editor
    // can't escalate. Keep this in sync with PROVISIONABLE_ROLES in
    // src/components/hr/EmployeeVerificationTable.tsx.
    const HR_PROVISIONABLE_ROLES = new Set([
      "principal", "admission_head", "hr_executive", "counsellor", "accountant", "faculty", "teacher",
      "data_entry", "office_admin", "office_assistant", "school_coordinator", "hostel_warden", "librarian",
    ]);
    const { data: callerRole } = await adminClient.rpc("get_user_role", {
      _user_id: callerId,
    });
    let authorized = callerRole === "super_admin";
    if (!authorized && HR_PROVISIONABLE_ROLES.has(role)) {
      const { data: canEditHr } = await adminClient.rpc("has_permission", {
        _user_id: callerId,
        _perm: "hr:employees_edit",
      });
      authorized = canEditHr === true;
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden: not permitted to invite this role" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lookup-only mode: detect an existing account for this email OR phone before
    // creating a duplicate. Uses the service-role RPC (not callable from the
    // browser) which normalises phone to digits and prefers an email match.
    if (lookup) {
      const { data: existingId } = await adminClient.rpc("find_auth_user_by_email_or_phone", {
        _email: email || null,
        _phone: phone || null,
      });
      if (!existingId) {
        return new Response(JSON.stringify({ existing: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: prof } = await adminClient
        .from("profiles")
        .select("display_name, email, phone")
        .eq("user_id", existingId)
        .maybeSingle();
      // A user may hold several roles — don't .maybeSingle() (it throws on >1).
      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", existingId)
        .limit(1)
        .maybeSingle();
      return new Response(JSON.stringify({
        existing: true,
        user_id: existingId,
        display_name: prof?.display_name ?? null,
        email: prof?.email ?? null,
        phone: prof?.phone ?? null,
        role: roleRow?.role ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let newUser: any;
    let reusedExisting = false;

    // Helper: locate existing auth user by email when create/invite fails as "already registered".
    const findExistingUserId = async (): Promise<string | null> => {
      // Fast path: profiles.email is populated by the handle_new_user trigger.
      const { data: prof } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("email", email)
        .maybeSingle();
      if (prof?.user_id) return prof.user_id;

      // Fallback: paginate auth.admin.listUsers.
      for (let page = 1; page <= 20; page++) {
        const { data } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
        const match = (data?.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (match) return match.id;
        if (!data?.users?.length || data.users.length < 200) break;
      }
      return null;
    };

    const isAlreadyExistsError = (msg: string) =>
      /already (been )?registered|already exists|email.*taken|duplicate/i.test(msg || "");

    if (password) {
      // Create user with password immediately (no email invite)
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: display_name || email,
          full_name: display_name || email,
        },
      });
      if (error) {
        if (isAlreadyExistsError(error.message)) {
          const existingId = await findExistingUserId();
          if (!existingId) {
            return new Response(JSON.stringify({ error: `User exists but couldn't be located: ${error.message}` }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // Reset their password to the one supplied so creds work, and confirm email.
          const { error: updErr } = await adminClient.auth.admin.updateUserById(existingId, {
            password,
            email_confirm: true,
          });
          if (updErr) {
            return new Response(JSON.stringify({ error: `Found existing user but password update failed: ${updErr.message}` }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          newUser = { user: { id: existingId } };
          reusedExisting = true;
        } else {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        newUser = data;
      }
    } else {
      // Send email invite via Resend (custom flow) instead of Supabase Auth's
      // built-in SMTP. The built-in path is throttled to 4-30 emails/hour and
      // was blocking real invites. Resend has its own quota and our domain
      // is verified there. Flow:
      //   1. generateLink({ type: 'invite' }) — creates the user + signed
      //      action link, but does NOT send any email itself.
      //   2. Render the link into the new-user-welcome template (or inline
      //      fallback) and POST it to Resend.
      // If generateLink fails with a duplicate-user error we fall through
      // to the existing exists-handler. If Resend itself is down we still
      // ship the user but log the email failure (the WhatsApp staff_welcome
      // below carries the same info).
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      const useResend = !!resendApiKey;

      const { data, error: inviteError } = useResend
        ? await adminClient.auth.admin.generateLink({
            type: "invite",
            email,
            options: {
              data: {
                display_name: display_name || email,
                full_name: display_name || email,
              },
            },
          })
        : await adminClient.auth.admin.inviteUserByEmail(email, {
            data: {
              display_name: display_name || email,
              full_name: display_name || email,
            },
          });

      // Send the email ourselves via Resend if we have a fresh action_link.
      const actionLink: string | undefined = useResend
        ? (data as any)?.properties?.action_link
        : undefined;
      if (sendNotify && useResend && actionLink && !inviteError) {
        try {
          const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
          const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          // Inline HTML — same visual language as the new-user-welcome
          // template in email_templates, but with the invite CTA instead
          // of an explicit password line.
          const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
  <img src="https://raw.githubusercontent.com/siddhant-6433/unios2-b1e81675/main/src/assets/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" />
  <h2 style="margin:0 0 8px">Welcome to NIMT UniOs, ${display_name || email}</h2>
  <p style="color:#475569;line-height:1.6;margin:0 0 16px">An account has been created for you as <strong>${roleLabel}</strong>${campus ? ` at <strong>${campus}</strong>` : ""}. Click the button below to set your password and sign in.</p>
  <p style="margin:24px 0">
    <a href="${actionLink}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9999px;font-weight:600">Activate your account</a>
  </p>
  <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin-top:24px">If the button doesn't work, paste this link into your browser:<br/><span style="word-break:break-all">${actionLink}</span></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
  <p style="color:#94a3b8;font-size:12px;margin:0">NIMT Educational Institutions — Admissions</p>
</div>`;
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: emailFrom,
              to: [email],
              subject: "Welcome to NIMT UniOs — Activate your account",
              html,
            }),
          });
          if (!resendRes.ok) {
            const txt = await resendRes.text().catch(() => "");
            console.error(`[invite-user] Resend send failed (${resendRes.status}):`, txt.slice(0, 300));
          }
        } catch (e) {
          console.error("[invite-user] Resend dispatch error:", (e as Error).message);
        }
      }

      if (inviteError) {
        if (isAlreadyExistsError(inviteError.message)) {
          const existingId = await findExistingUserId();
          if (!existingId) {
            return new Response(JSON.stringify({ error: `User exists but couldn't be located: ${inviteError.message}` }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          newUser = { user: { id: existingId } };
          reusedExisting = true;
        } else if (
          // Supabase Auth rate-limits the built-in SMTP at 4-30/hr. When we
          // hit that, fall back to creating the user without an email so
          // the invite isn't blocked — they can still log in via WhatsApp
          // OTP (the staff_welcome template fires below if phone is set).
          /rate limit|too many requests|429/i.test(inviteError.message || "")
        ) {
          const tempPassword = `nimt-${crypto.randomUUID().slice(0, 12)}`;
          const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              display_name: display_name || email,
              full_name: display_name || email,
            },
          });
          if (createErr) {
            return new Response(JSON.stringify({
              error: `Email rate-limited and fallback create failed: ${createErr.message}`,
            }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          newUser = created;
          // Surface to the client so the toast can mention the fallback.
          (newUser as any)._email_skipped_reason = "rate_limit";
        } else {
          return new Response(JSON.stringify({ error: inviteError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        newUser = data;
      }
    }

    // Normalise phone: ensure it starts with +
    const normalizedPhone = phone
      ? (phone.startsWith("+") ? phone : `+${phone}`)
      : undefined;

    // Upsert profile with additional info
    // (profile may already exist from the handle_new_user trigger)
    if (display_name || campus || normalizedPhone) {
      const profileUpdate: Record<string, string> = { user_id: newUser.user.id };
      if (display_name) profileUpdate.display_name = display_name;
      if (campus) profileUpdate.campus = campus;
      if (normalizedPhone) profileUpdate.phone = normalizedPhone;

      await adminClient
        .from("profiles")
        .upsert(profileUpdate, { onConflict: "user_id" });
    }

    // Ensure the requested role exists — ADDITIVE and idempotent. Users can hold
    // multiple roles (UNIQUE(user_id, role)); inviting/provisioning must never
    // wipe a role the user already has. Role removal is done explicitly elsewhere
    // (admin panel / employee dialog), not here.
    {
      const { error: roleError } = await adminClient
        .from("user_roles")
        .upsert({ user_id: newUser.user.id, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (roleError) {
        return new Response(JSON.stringify({ error: roleError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const selectedTeamIds = Array.isArray(team_ids)
      ? [...new Set(team_ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0))]
      : [];

    if (role === "counsellor" && selectedTeamIds.length > 0) {
      const { error: teamErr } = await adminClient
        .from("team_members")
        .upsert(
          selectedTeamIds.map((teamId) => ({ team_id: teamId, user_id: newUser.user.id })),
          { onConflict: "team_id,user_id", ignoreDuplicates: true },
        );
      if (teamErr) {
        return new Response(JSON.stringify({ error: `Failed to add counsellor to teams: ${teamErr.message}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Send WhatsApp staff_welcome if phone is provided (and notifications enabled)
    if (sendNotify && normalizedPhone) {
      try {
        const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
        const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
        if (waToken && phoneNumberId) {
          const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const waPhone = normalizedPhone.replace(/[^0-9]/g, "");
          const waPayload = {
            messaging_product: "whatsapp",
            to: waPhone,
            type: "template",
            template: {
              name: "nimt_new_staff",
              language: { code: "en" },
              components: [{
                type: "body",
                parameters: [
                  { type: "text", text: display_name || email },
                  { type: "text", text: roleLabel },
                  { type: "text", text: campus || "NIMT Educational Institutions" },
                ],
              }],
            },
          };
          const waRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(waPayload),
          });
          const waResult = await waRes.json();
          if (!waRes.ok) {
            console.error("Staff WhatsApp failed:", waResult?.error?.message);
          } else {
            const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            const campusLabel = campus || "NIMT Educational Institutions";
            // Log the full rendered message text
            await adminClient.from("whatsapp_messages").insert({
              wa_message_id: waResult?.messages?.[0]?.id || null,
              direction: "outbound",
              phone: waPhone,
              message_type: "template",
              content: `Welcome to NIMT Educational Institutions, ${display_name || email}!\n\nYour account has been created.\nLogin: ${email}\nRole: ${roleLabel}\nCampus: ${campusLabel}\n\nPlease login at https://uni.nimt.ac.in to get started.\n\nFor any assistance, contact the admin office.`,
              template_key: "staff_welcome",
              status: "sent",
              is_read: true,
            });
          }
        }
      } catch (e) {
        console.error("Staff WhatsApp error:", e);
      }
    }

    // Send welcome email with credentials (if password was set and notifications enabled)
    if (sendNotify && password) {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        try {
          // Fetch template from DB
          const { data: tpl } = await adminClient
            .from("email_templates")
            .select("subject, body_html")
            .eq("slug", "new-user-welcome")
            .eq("is_active", true)
            .single();

          if (tpl) {
            const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            const vars: Record<string, string> = {
              display_name: display_name || email,
              email,
              password,
              role: roleLabel,
            };

            let subject = tpl.subject;
            let bodyHtml = tpl.body_html;
            for (const [k, v] of Object.entries(vars)) {
              const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
              subject = subject.replace(re, v);
              bodyHtml = bodyHtml.replace(re, v);
            }

            const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ from: emailFrom, to: [email], subject, html: bodyHtml }),
            });
          }
        } catch (e) {
          console.error("Welcome email failed:", e);
        }
      }
    }

    // Publisher-role linking: handled here with service role so RLS can't silently block it.
    if (role === "publisher") {
      const userId = newUser.user.id;
      const desiredDisplay = display_name || email;

      if (publisher_id) {
        // Caller specified the exact publisher row to link.
        // First clear any other row currently holding this user_id (UNIQUE constraint).
        await adminClient.from("publishers")
          .update({ user_id: null })
          .eq("user_id", userId)
          .neq("id", publisher_id);

        const { error: linkErr } = await adminClient.from("publishers")
          .update({ user_id: userId, display_name: desiredDisplay, is_active: true })
          .eq("id", publisher_id);
        if (linkErr) {
          return new Response(JSON.stringify({ error: `Failed to link publisher row: ${linkErr.message}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else if (publisher_source) {
        // Fallback: caller didn't pin a row. Reuse if user is already linked anywhere;
        // else find the first unlinked row for this source; else insert one.
        const { data: alreadyLinked } = await adminClient.from("publishers")
          .select("id").eq("user_id", userId).maybeSingle();
        if (!alreadyLinked) {
          const { data: bySource } = await adminClient.from("publishers")
            .select("id").eq("source", publisher_source).is("user_id", null).limit(1).maybeSingle();
          if (bySource) {
            await adminClient.from("publishers")
              .update({ user_id: userId, display_name: desiredDisplay })
              .eq("id", bySource.id);
          } else {
            await adminClient.from("publishers").insert({
              display_name: desiredDisplay,
              source: publisher_source,
              user_id: userId,
              is_active: true,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUser.user.id,
        reused_existing: reusedExisting,
        // Tell the client when the email channel was skipped so the toast
        // can surface the right message ("invite sent" vs "email rate-
        // limited, WhatsApp delivered").
        email_skipped_reason: (newUser as any)?._email_skipped_reason || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
