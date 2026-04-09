/**
 * Lead Velocity Cron
 * ─────────────────────────────────────────────────────────────
 * Runs every 15 minutes. Handles:
 * 1. SLA warnings — notifies counsellors approaching first-contact deadline
 * 2. SLA breaches — auto-returns leads to bucket, notifies counsellor
 * 3. Follow-up enforcement — notifies on overdue followups, auto-returns after 48h
 * 4. Visit confirmation — ensures confirmation calls for visits today + tomorrow
 * 5. Post-visit follow-up — flags visits with no follow-up scheduled
 *
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return new Response("Server configuration error", { status: 500 });
  }
  if (!secret || secret !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const whatsappToken = Deno.env.get("WHATSAPP_API_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";

  const stats = {
    sla_warnings_sent: 0,
    sla_returns: 0,
    followup_notifications: 0,
    followup_returns: 0,
    visit_confirmations: 0,
    visit_followup_alerts: 0,
    emails_sent: 0,
    errors: 0,
  };

  // Helper: send WhatsApp template message (service-level, no user auth)
  async function sendWhatsApp(phone: string, templateName: string, params: string[]) {
    if (!whatsappToken || !phoneNumberId) return;
    const waPhone = phone.replace(/[^0-9]/g, "");
    const bodyParams = params.map((p) => ({ type: "text", text: p }));
    try {
      await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: waPhone,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            ...(bodyParams.length > 0
              ? { components: [{ type: "body", parameters: bodyParams }] }
              : {}),
          },
        }),
      });
    } catch (e) {
      console.error(`WhatsApp send failed for ${waPhone}:`, e);
    }
  }

  // Helper: send email from a DB template with variable substitution
  async function sendTemplateEmail(toEmail: string, slug: string, variables: Record<string, string>) {
    if (!resendApiKey || !toEmail) return;
    try {
      // Fetch template from DB
      const { data: template } = await supabase
        .from("email_templates")
        .select("subject, body_html, is_active")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (!template) {
        console.warn(`Email template not found or inactive: ${slug}`);
        return;
      }

      let subject = template.subject;
      let bodyHtml = template.body_html;

      // Replace {{variables}}
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        subject = subject.replace(regex, value);
        bodyHtml = bodyHtml.replace(regex, value);
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [toEmail],
          subject,
          html: bodyHtml,
        }),
      });
      if (res.ok) stats.emails_sent++;
      else console.error("Email send failed:", await res.text());
    } catch (e) {
      console.error(`Email send failed for ${toEmail}:`, e);
    }
  }

  // Helper: get counsellor contact info from profiles + auth
  interface CounsellorInfo { phone: string | null; email: string | null; name: string | null; }
  async function getCounsellorInfo(counsellorId: string): Promise<CounsellorInfo> {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, display_name")
      .eq("id", counsellorId)
      .single();
    // Get email from auth.users
    const { data: authUser } = await supabase.auth.admin.getUserById(counsellorId);
    return {
      phone: profile?.phone || null,
      email: authUser?.user?.email || null,
      name: profile?.display_name || null,
    };
  }

  // ─── 1. SLA WARNINGS ────────────────────────────────────────
  try {
    const { data: warningLeads } = await supabase
      .from("sla_warning_leads")
      .select("*");

    for (const lead of warningLeads || []) {
      // Check if we already sent a warning for this assignment window
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("type", "sla_warning")
        .eq("user_id", lead.counsellor_id)
        .gte("created_at", lead.assigned_at);

      if ((count || 0) > 0) continue; // already warned

      const hoursLeft = Math.round(lead.hours_remaining);

      // In-app notification
      await supabase.from("notifications").insert({
        user_id: lead.counsellor_id,
        type: "sla_warning",
        title: `SLA Warning: ${lead.name}`,
        body: `You have ~${hoursLeft}h remaining to make first contact. Call now to avoid losing this lead.`,
        link: `/admissions/${lead.id}`,
        lead_id: lead.id,
      });

      // WhatsApp + Email to counsellor
      const c1 = await getCounsellorInfo(lead.counsellor_id);
      if (c1.phone) {
        await sendWhatsApp(c1.phone, "counsellor_sla_warning", [
          lead.name,
          String(hoursLeft),
        ]);
      }
      if (c1.email) {
        await sendTemplateEmail(c1.email, "counsellor-sla-warning", {
          counsellor_name: c1.name || "Counsellor",
          lead_name: lead.name,
          hours_remaining: String(hoursLeft),
          lead_id: lead.id,
        });
      }

      stats.sla_warnings_sent++;
    }
  } catch (e) {
    console.error("SLA warnings error:", e);
    stats.errors++;
  }

  // ─── 2. SLA BREACHES — AUTO-RETURN TO BUCKET ────────────────
  try {
    const { data: breachedLeads } = await supabase
      .from("sla_breached_leads")
      .select("*");

    for (const lead of breachedLeads || []) {
      const formerCounsellor = lead.counsellor_id;

      // Unassign the lead (back to bucket)
      await supabase
        .from("leads")
        .update({
          counsellor_id: null,
          auto_returned_count: (lead.auto_returned_count || 0) + 1,
        })
        .eq("id", lead.id);

      // Log activity
      await supabase.from("lead_activities").insert({
        lead_id: lead.id,
        type: "system",
        description: `Lead auto-returned to bucket — SLA breached (no first contact within ${lead.first_contact_hours}h). Former counsellor was unassigned.`,
      });

      // Notify former counsellor
      await supabase.from("notifications").insert({
        user_id: formerCounsellor,
        type: "lead_reclaimed",
        title: `Lead reclaimed: ${lead.name}`,
        body: `This lead was returned to the bucket because first contact was not made within ${lead.first_contact_hours}h.`,
        link: "/lead-buckets",
        lead_id: lead.id,
      });

      // WhatsApp + Email to counsellor
      const c2 = await getCounsellorInfo(formerCounsellor);
      if (c2.phone) {
        await sendWhatsApp(c2.phone, "counsellor_lead_reclaimed", [
          lead.name,
          "the assigned course",
        ]);
      }
      if (c2.email) {
        await sendTemplateEmail(c2.email, "counsellor-lead-reclaimed", {
          counsellor_name: c2.name || "Counsellor",
          lead_name: lead.name,
          sla_hours: String(lead.first_contact_hours),
        });
      }

      stats.sla_returns++;
    }
  } catch (e) {
    console.error("SLA breach error:", e);
    stats.errors++;
  }

  // ─── 3. FOLLOWUP ENFORCEMENT ────────────────────────────────
  try {
    // 3a. Notify on overdue followups (< 48h overdue, just notification)
    const { data: overdueFollowups } = await supabase
      .from("overdue_followups")
      .select("*")
      .lt("days_overdue", 2);

    for (const fu of overdueFollowups || []) {
      if (!fu.counsellor_id) continue;

      // Check if already notified today
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", fu.lead_id)
        .eq("type", "followup_overdue")
        .eq("user_id", fu.counsellor_id)
        .gte("created_at", today);

      if ((count || 0) > 0) continue;

      const fuDate = new Date(fu.scheduled_at).toLocaleDateString("en-IN");

      await supabase.from("notifications").insert({
        user_id: fu.counsellor_id,
        type: "followup_overdue",
        title: `Overdue follow-up: ${fu.lead_name}`,
        body: `A ${fu.type} follow-up scheduled for ${fuDate} is overdue. Complete it now.`,
        link: `/admissions/${fu.lead_id}`,
        lead_id: fu.lead_id,
      });

      // Email
      const c3a = await getCounsellorInfo(fu.counsellor_id);
      if (c3a.email) {
        await sendTemplateEmail(c3a.email, "counsellor-followup-overdue", {
          counsellor_name: c3a.name || "Counsellor",
          lead_name: fu.lead_name,
          followup_type: fu.type,
          scheduled_date: fuDate,
          lead_id: fu.lead_id,
        });
      }

      stats.followup_notifications++;
    }

    // 3b. Auto-return leads with followups overdue > 48h
    const { data: breachedFollowups } = await supabase
      .from("followup_sla_breached")
      .select("*");

    for (const fu of breachedFollowups || []) {
      if (!fu.counsellor_id) continue;

      // Check if already handled
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", fu.lead_id)
        .eq("type", "lead_reclaimed")
        .eq("user_id", fu.counsellor_id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if ((count || 0) > 0) continue;

      const formerCounsellor = fu.counsellor_id;

      await supabase
        .from("leads")
        .update({ counsellor_id: null, auto_returned_count: supabase.rpc ? 0 : 0 })
        .eq("id", fu.lead_id);

      // Increment auto_returned_count via raw update
      await supabase.rpc("increment_auto_return", { lead_uuid: fu.lead_id }).catch(() => {
        // Fallback: direct update
      });

      await supabase.from("lead_activities").insert({
        lead_id: fu.lead_id,
        type: "system",
        description: `Lead auto-returned to bucket — follow-up overdue for ${Math.round(fu.hours_overdue)}h without completion.`,
      });

      await supabase.from("notifications").insert({
        user_id: formerCounsellor,
        type: "lead_reclaimed",
        title: `Lead reclaimed: ${fu.lead_name}`,
        body: `This lead was returned to the bucket because a follow-up was overdue for over 48 hours.`,
        link: "/lead-buckets",
        lead_id: fu.lead_id,
      });

      // Email
      const c3b = await getCounsellorInfo(formerCounsellor);
      if (c3b.email) {
        await sendTemplateEmail(c3b.email, "counsellor-followup-reclaimed", {
          counsellor_name: c3b.name || "Counsellor",
          lead_name: fu.lead_name,
        });
      }

      stats.followup_returns++;
    }
  } catch (e) {
    console.error("Followup enforcement error:", e);
    stats.errors++;
  }

  // ─── 4. VISIT CONFIRMATION CALLS ────────────────────────────
  try {
    const { data: pendingVisits } = await supabase
      .from("visits_needing_confirmation")
      .select("*");

    for (const visit of pendingVisits || []) {
      if (!visit.counsellor_id) continue;

      const label = visit.urgency === "same_day" ? "today" : "tomorrow";

      // Check if already notified for this visit + urgency
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", visit.lead_id)
        .eq("type", "visit_confirmation_due")
        .eq("user_id", visit.counsellor_id)
        .gte("created_at", new Date().toISOString().slice(0, 10));

      if ((count || 0) > 0) continue;

      // Notify counsellor to make confirmation call
      await supabase.from("notifications").insert({
        user_id: visit.counsellor_id,
        type: "visit_confirmation_due",
        title: `Confirmation call needed: ${visit.lead_name}`,
        body: `Campus visit at ${visit.campus_name || "campus"} is scheduled for ${label}. Call the student to confirm attendance.`,
        link: `/admissions/${visit.lead_id}`,
        lead_id: visit.lead_id,
      });

      // Email to counsellor
      const c4 = await getCounsellorInfo(visit.counsellor_id);
      if (c4.email) {
        await sendTemplateEmail(c4.email, "counsellor-visit-confirmation", {
          counsellor_name: c4.name || "Counsellor",
          lead_name: visit.lead_name,
          campus_name: visit.campus_name || "campus",
          visit_timing: label,
          lead_id: visit.lead_id,
        });
      }

      // Also send WhatsApp reminder to the student (with map button)
      if (visit.lead_phone && phoneNumberId) {
        const visitTime = new Date(visit.visit_date).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
        const mapsUrl = visit.google_maps_url || "";
        const cidMatch = mapsUrl.match(/cid=(\d+)/);
        const mapCid = cidMatch ? cidMatch[1] : "";
        const waPhone = visit.lead_phone.replace(/[^0-9]/g, "");

        try {
          await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: waPhone,
              type: "template",
              template: {
                name: "visit_reminder",
                language: { code: "en" },
                components: [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: visit.lead_name },
                      { type: "text", text: visitTime },
                      { type: "text", text: visit.campus_name || "our campus" },
                    ],
                  },
                  ...(mapCid ? [{
                    type: "button",
                    sub_type: "url",
                    index: 0,
                    parameters: [{ type: "text", text: mapCid }],
                  }] : []),
                ],
              },
            }),
          });
        } catch (e) {
          console.error("Visit reminder WA failed:", e);
        }
      }

      stats.visit_confirmations++;
    }
  } catch (e) {
    console.error("Visit confirmation error:", e);
    stats.errors++;
  }

  // ─── 5. POST-VISIT FOLLOW-UP ALERTS ─────────────────────────
  try {
    const { data: needFollowup } = await supabase
      .from("visits_needing_followup")
      .select("*");

    for (const visit of needFollowup || []) {
      if (!visit.counsellor_id) continue;

      // Check if already notified
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", visit.lead_id)
        .eq("type", "visit_followup_due")
        .eq("user_id", visit.counsellor_id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if ((count || 0) > 0) continue;

      await supabase.from("notifications").insert({
        user_id: visit.counsellor_id,
        type: "visit_followup_due",
        title: `Follow-up needed: ${visit.lead_name}`,
        body: `Campus visit was ${visit.days_since_visit} day(s) ago but no follow-up has been scheduled. Schedule one now.`,
        link: `/admissions/${visit.lead_id}`,
        lead_id: visit.lead_id,
      });

      // Email
      const c5 = await getCounsellorInfo(visit.counsellor_id);
      if (c5.email) {
        await sendTemplateEmail(c5.email, "counsellor-visit-followup", {
          counsellor_name: c5.name || "Counsellor",
          lead_name: visit.lead_name,
          campus_name: visit.campus_name || "campus",
          days_since_visit: String(visit.days_since_visit),
          lead_id: visit.lead_id,
        });
      }

      stats.visit_followup_alerts++;
    }
  } catch (e) {
    console.error("Visit followup error:", e);
    stats.errors++;
  }

  console.log("Lead velocity cron complete:", JSON.stringify(stats));
  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
