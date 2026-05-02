import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, Search, Send, Loader2, User, Clock, ExternalLink, ArrowLeft,
  FileDown, AlertTriangle, LayoutTemplate, X, Check, ChevronDown, Zap, Ban, Settings,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface Conversation {
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_stage: string | null;
  lead_person_role: string | null;
  course_name: string | null;
  last_message: string | null;
  last_direction: string;
  last_message_at: string;
  unread_count: number;
  counsellor_id: string | null;
  counsellor_name: string | null;
  has_inbound: boolean;
  business_phone_number_id: string | null;
  business_phone_number: string | null;
}

interface Message {
  id: string;
  direction: string;
  content: string | null;
  message_type: string;
  status: string;
  template_key: string | null;
  media_url: string | null;
  created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  offer_sent: "Offer Sent", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
};

const QUICK_REPLIES = [
  { label: "Greeting", text: "Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?" },
  { label: "Ask course", text: "Which course are you interested in? We offer Engineering, Management, Law, Pharmacy, Nursing, Education and more." },
  { label: "Share portal", text: "You can apply online at our application portal:\nhttps://uni.nimt.ac.in/apply/nimt" },
  { label: "Fee info", text: "Our fee structure varies by course and campus. Could you tell us which course you're interested in? A counsellor will share the detailed fee breakdown." },
  { label: "Schedule visit", text: "We'd love to have you visit our campus! 🏫 Please share your preferred date and the campus you'd like to visit." },
  { label: "Counsellor connect", text: "Our counsellor will connect with you shortly. Thank you for your patience!" },
  { label: "Documents needed", text: "For admission, please keep these documents ready:\n📄 10th & 12th marksheets\n📄 Aadhaar card\n📄 Passport-size photo\n📄 Transfer certificate" },
  { label: "Thank you", text: "Thank you for reaching out! 😊 Feel free to contact us anytime if you have more questions." },
  { label: "Campus video", text: "🎥 Here's a look at our campus and facilities:\nhttps://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK" },
];

const INBOX_TEMPLATES = [
  // ── Admission flow ────────────────────────────────────────────────────────
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Welcome message with course info",
    params: ["student_name", "course_name"],
    preview: "Hi {{student_name}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{course_name}}. Our counsellor will connect with you shortly to guide you through the admission process.",
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirm scheduled campus visit",
    params: ["student_name", "visit_date", "campus_name"],
    preview: "Hi {{student_name}}, your campus visit is confirmed for {{visit_date}} at {{campus_name}}. We look forward to welcoming you! Please carry a valid ID.",
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder (24hr)",
    description: "Remind about upcoming visit",
    params: ["student_name", "visit_date"],
    preview: "Hi {{student_name}}, this is a reminder that your campus visit is scheduled for {{visit_date}}. See you soon!",
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "Acknowledge application submission",
    params: ["student_name", "application_id"],
    preview: "Hi {{student_name}}, we've received your application (ID: {{application_id}}). Our admissions team will review it and get back to you shortly.",
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Remind about pending fee payment",
    params: ["student_name", "amount", "due_date"],
    preview: "Hi {{student_name}}, this is a reminder that your fee of ₹{{amount}} is due by {{due_date}}. Please complete the payment to secure your seat.",
  },
  // ── Knowledge Base Quick Replies ─────────────────────────────────────────
  {
    key: "kb_apply_link",
    label: "📎 Application Link",
    description: "Share the online application portal link",
    params: [],
    preview: "Hi! 👋 Here's your link to apply online at NIMT:\n\n🔗 https://uni.nimt.ac.in/apply/nimt\n\nFill in your details and our admissions team will guide you through the next steps. For help, call us at 📞 +91 9555192192.",
  },
  {
    key: "kb_campus_addresses",
    label: "📍 Campus Addresses",
    description: "All 5 NIMT campus locations",
    params: [],
    preview: "📍 *NIMT Campus Locations*\n\n🏫 *Greater Noida (Main)*\nPlot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310\n\n🏫 *Ghaziabad – Arthala*\nNear Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007\n\n🏫 *Ghaziabad – Avantika*\nAnsal Avantika Colony, Shastri Nagar, Ghaziabad 201015\n\n🏫 *Ghaziabad – Avantika II*\nAvantika Extension Colony, Ghaziabad\n\n🏫 *Kotputli, Jaipur*\nSP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108\n\nFor directions or to schedule a visit, call 📞 +91 9555192192.",
  },
  {
    key: "kb_rankings",
    label: "🏆 Rankings & Recognition",
    description: "NIMT rankings and accreditations",
    params: [],
    preview: "🏆 *NIMT Rankings & Recognition*\n\n⭐ #1 in UP — EW Higher Education Rankings\n📊 Ranked 34th B-School — Business India\n⭐ PGDM ranked #8 in India\n📰 #57 Law in India — India Today 2025\n🎖️ AA+ rated — Digital Learning Magazine\n✅ 6 institutions NIRF ranked 2025\n\n*Approvals:* AICTE, UGC, Bar Council of India, NCTE, Indian Nursing Council, Pharmacy Council of India\n*Affiliations:* AKTU, GGSIPU, ABVMU, CCSU, University of Rajasthan\n\nWould you like to know more about a specific course or campus?",
  },
  {
    key: "kb_approvals",
    label: "✅ Approvals & Affiliations",
    description: "Regulatory approvals and university affiliations",
    params: [],
    preview: "✅ *NIMT Approvals & Affiliations*\n\n*Approved by:*\n• AICTE (All India Council for Technical Education)\n• UGC (University Grants Commission)\n• Bar Council of India (BCI) — Law programmes\n• NCTE (National Council for Teacher Education) — B.Ed\n• Indian Nursing Council (INC) — Nursing\n• Pharmacy Council of India (PCI) — D Pharma\n\n*Affiliated to:*\n• AKTU (Dr. A.P.J. Abdul Kalam Technical University)\n• GGSIPU (Guru Gobind Singh Indraprastha University)\n• ABVMU (Atal Bihari Vajpayee Medical University)\n• CCSU (Chaudhary Charan Singh University)\n• Dr. Bhimrao Ambedkar Law University (ALU)\n• University of Rajasthan (Kotputli campus)\n\nAll programmes are fully accredited and recognised. Any questions?",
  },
  {
    key: "kb_scholarships",
    label: "🎓 Scholarships",
    description: "Scholarship schemes available at NIMT",
    params: [],
    preview: "🎓 *NIMT Scholarship Schemes*\n\nWe offer multiple scholarship opportunities:\n\n• 🏅 *Merit Scholarship* — For students with outstanding academic performance\n• 🤝 *SC/ST/OBC Scholarships* — As per government norms\n• ⚽ *Sports Scholarship* — For national/state level athletes\n• 🏥 *Nursing Scholarship* — Supported by INC guidelines\n• 👥 *Alumni Referral Discount* — For referrals from NIMT alumni\n\nFor detailed eligibility and current scholarship amounts, please call our admissions office:\n📞 +91 9555192192\n\nOr apply online at: https://uni.nimt.ac.in/apply/nimt",
  },
  {
    key: "kb_placements",
    label: "💼 Placements",
    description: "Placement stats and top recruiters",
    params: [],
    preview: "💼 *NIMT Placement Highlights*\n\n📈 Highest Package: INR 18.75 LPA\n📊 Average Package: INR 5.40 LPA\n🏢 1,200+ corporate placement partners\n🎯 60+ companies visit campus annually\n\n*Top Recruiters:*\nFortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys, Deloitte, TCS\n\n*By Course:*\n• MBA/PGDM: Highest 18.75 LPA, Avg 5.40 LPA\n• B.Sc Nursing: Highest 10 LPA, Avg 3 LPA (~98% placement rate)\n\nWould you like placement details for a specific course?",
  },
  {
    key: "kb_eligibility",
    label: "📋 Eligibility — General",
    description: "Quick eligibility overview for popular courses",
    params: [],
    preview: "📋 *Eligibility Overview — Popular Courses*\n\n🏥 *B.Sc Nursing:* 10+2 PCB, min 45%, age 17+\n🏥 *GNM:* 10+2 any stream, min 40%, age 17-35 (Science NOT required!)\n🦾 *BPT (Physiotherapy):* 10+2 PCB, min 45%\n⚖️ *BA LLB (5yr):* 12th pass, min 45%\n⚖️ *LLB (3yr):* Graduation any stream, min 45%\n🎓 *MBA:* Bachelor's degree, min 50%, valid entrance score (CAT/MAT/XAT/CMAT)\n🎓 *PGDM:* Bachelor's degree, min 50%, CAT/MAT/XAT/CMAT\n🖥️ *BCA:* 12th with Maths, min 45%\n📊 *BBA:* 12th any stream, min 45%\n💊 *D Pharma:* 10+2 PCB/PCM, min 50%\n\nFor course-specific eligibility, please share which course you're interested in!",
  },
  {
    key: "kb_fee_structure",
    label: "💰 Fee Structure",
    description: "Fee information and how to get details",
    params: [],
    preview: "💰 *NIMT Fee Structure*\n\nFee varies by course and campus. Here's a general guide:\n\n🏥 *Nursing (B.Sc / GNM):* Contact admissions for latest fee\n🦾 *BPT (Physiotherapy):* Contact admissions for latest fee\n🎓 *MBA / PGDM:* Contact admissions for latest fee\n⚖️ *LLB / BA LLB:* Contact admissions for latest fee\n📊 *BBA / BCA:* Contact admissions for latest fee\n\n✅ Application Fee: Rs 500–1,000 (varies by course)\n✅ Merit scholarships available to reduce fee burden\n✅ Education loan assistance available\n\nFor the exact fee structure for your course, call:\n📞 +91 9555192192\nOr apply online: https://uni.nimt.ac.in/apply/nimt",
  },
  {
    key: "kb_course_details",
    label: "📚 Course Details",
    description: "Send course-specific details",
    params: ["student_name", "course_name"],
    preview: "Hi {{student_name}}! Here are the key highlights for *{{course_name}}* at NIMT:\n\nPlease visit https://nimt.ac.in/courses for the full brochure, or our counsellor will share the detailed course guide with you shortly.\n\nWould you like to schedule a campus visit or speak with a counsellor? 😊",
  },
];

const isAdminRole = (role: string | null | undefined) =>
  role === "super_admin" || role === "admission_head" || role === "campus_admin";

const ALLOWED_ROLES = new Set(["super_admin", "campus_admin", "principal", "admission_head", "counsellor"]);

const WhatsAppInbox = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, role, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const isOutboundMode = searchParams.get("mode") === "outbound";
  const phoneParam = searchParams.get("phone");

  if (role && !ALLOWED_ROLES.has(role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <p>You don't have access to the WhatsApp Inbox.</p>
      </div>
    );
  }
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [inboxTab, setInboxTab] = useState<"all" | "leads" | "staff" | "jobs" | "other">("all");
  // Multi-number inbox: which business number's conversations to show.
  // "primary" = the most-used phone_number_id + legacy NULL rows; any other
  // distinct phone_number_id is shown as its own inbox.
  const [businessNumber, setBusinessNumber] = useState<string>("primary");
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [staffConvs, setStaffConvs] = useState<Conversation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Admin-only state
  const [counsellorList, setCounsellorList] = useState<{ id: string; name: string }[]>([]);
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [unrepliedOnly, setUnrepliedOnly] = useState(false);
  const [unrepliedByCC, setUnrepliedByCC] = useState<{ id: string; name: string; count: number }[]>([]);
  const [unrepliedPanelOpen, setUnrepliedPanelOpen] = useState(true);

  // Backfill dialog state
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [bfPrimaryPnid, setBfPrimaryPnid] = useState("");
  const [bfPrimaryNumber, setBfPrimaryNumber] = useState("");
  const [bfSecondaryPnid, setBfSecondaryPnid] = useState("");
  const [bfSecondaryNumber, setBfSecondaryNumber] = useState("");
  const [bfRunning, setBfRunning] = useState(false);
  const [bfResult, setBfResult] = useState<any>(null);

  // Multi-inbox: rank pnids by message count → most-used is "primary".
  const { primaryPnid, otherInboxes } = (() => {
    const counts = new Map<string, { label: string; n: number }>();
    for (const c of conversations) {
      if (!c.business_phone_number_id) continue;
      const key = c.business_phone_number_id;
      const cur = counts.get(key) || { label: c.business_phone_number || key, n: 0 };
      cur.n += 1;
      counts.set(key, cur);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
    return {
      primaryPnid: sorted[0]?.[0] || null as string | null,
      otherInboxes: sorted.slice(1).map(([id, v]) => ({ id, label: v.label })),
    };
  })();
  const hasOtherInbox = otherInboxes.length > 0;

  // Pre-fill backfill form when dialog opens, using detected pnids if any
  const openBackfill = () => {
    setBfResult(null);
    setBfPrimaryPnid(prev => prev || (primaryPnid ?? ""));
    setBfPrimaryNumber(prev => prev || (conversations.find(c => c.business_phone_number_id === primaryPnid)?.business_phone_number ?? ""));
    setBfSecondaryPnid(prev => prev || (otherInboxes[0]?.id ?? ""));
    setBfSecondaryNumber(prev => prev || (otherInboxes[0]?.label ?? ""));
    setBackfillOpen(true);
  };

  const runBackfill = async () => {
    if (!bfPrimaryPnid || !bfSecondaryPnid) {
      toast({ title: "Both phone_number_ids are required", variant: "destructive" });
      return;
    }
    if (bfPrimaryPnid === bfSecondaryPnid) {
      toast({ title: "Primary and secondary IDs must differ", variant: "destructive" });
      return;
    }
    setBfRunning(true);
    setBfResult(null);
    const { data, error } = await (supabase.rpc as any)("backfill_wa_inboxes_heuristic", {
      primary_pnid: bfPrimaryPnid,
      primary_number: bfPrimaryNumber || null,
      secondary_pnid: bfSecondaryPnid,
      secondary_number: bfSecondaryNumber || null,
    });
    setBfRunning(false);
    if (error) {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
      return;
    }
    setBfResult(data);
    toast({ title: "Backfill complete", description: `Primary: ${data?.primary_threads ?? 0} threads · Secondary: ${data?.secondary_threads ?? 0} threads` });
  };

  const matchesInbox = (c: Conversation) => {
    if (businessNumber === "primary") {
      return !c.business_phone_number_id || c.business_phone_number_id === primaryPnid;
    }
    return c.business_phone_number_id === businessNumber;
  };

  // Fetch conversations + build staff list
  useEffect(() => {
    (async () => {
      // Fetch ALL conversations in batches (Supabase caps at 1000 per query)
      let allConvData: any[] = [];
      let offset = 0;
      const BATCH = 1000;
      while (true) {
        let q = supabase
          .from("whatsapp_conversations" as any)
          .select("*")
          .order("last_message_at", { ascending: false })
          .range(offset, offset + BATCH - 1);

        if (role === "counsellor" && profile?.id) {
          q = q.eq("counsellor_id", profile.id);
        } else if (isAdminRole(role)) {
          if (counsellorFilter === "unassigned") {
            q = (q as any).is("counsellor_id", null);
          } else if (counsellorFilter !== "all") {
            q = q.eq("counsellor_id", counsellorFilter);
          }
        }

        const { data } = await q;
        if (!data || (data as any[]).length === 0) break;
        allConvData = [...allConvData, ...(data as any[])];
        if ((data as any[]).length < BATCH) break; // last page
        offset += BATCH;
      }

      setConversations(allConvData);

      // Fetch ALL staff/counsellor profiles with phone numbers
      const { data: staffProfiles } = await supabase
        .from("profiles")
        .select("phone, display_name, user_id")
        .not("phone", "is", null);

      const { data: staffRoles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["super_admin", "campus_admin", "principal", "admission_head", "counsellor", "accountant", "faculty", "teacher", "data_entry", "office_admin", "office_assistant", "hostel_warden"]);

      const staffUserIds = new Set((staffRoles || []).map((r: any) => r.user_id));
      const nameMap: Record<string, string> = {};
      const syntheticConvs: Conversation[] = [];
      const existingPhones = new Set(allConvData.map((c: any) => c.phone));

      for (const p of (staffProfiles || [])) {
        if (!p.phone || !staffUserIds.has(p.user_id)) continue;
        const digits = p.phone.replace(/\D/g, "");
        if (p.display_name) nameMap[digits] = p.display_name;

        // Only create synthetic entries for staff with NO existing conversation
        // (staff who already have a conversation in the DB are shown from allConvData)
        if (!existingPhones.has(digits)) {
          syntheticConvs.push({
            phone: digits,
            lead_id: null,
            lead_name: null,
            lead_stage: null,
            last_message: null,
            last_direction: "outbound",
            last_message_at: "1970-01-01T00:00:00Z", // no messages yet — sort to bottom
            unread_count: 0,
            counsellor_id: null,
            counsellor_name: null,
          });
        }
      }

      setStaffNames(nameMap);
      setStaffConvs(syntheticConvs);

      // Fetch counsellor list for admins
      if (isAdminRole(role)) {
        const { data: ccRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "counsellor");

        if (ccRoles && ccRoles.length > 0) {
          const ccUserIds = ccRoles.map((r: any) => r.user_id);
          const { data: ccProfiles } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("user_id", ccUserIds);

          if (ccProfiles) {
            setCounsellorList(
              ccProfiles
                .filter((p: any) => p.display_name)
                .map((p: any) => ({ id: p.id, name: p.display_name }))
            );
          }
        }
      }

      setLoading(false);
    })();
  }, [role, profile?.id, counsellorFilter]);

  // Fetch unreplied breakdown for admins — separate unlimited query
  useEffect(() => {
    if (!isAdminRole(role) || counsellorList.length === 0) { setUnrepliedByCC([]); return; }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations" as any)
        .select("counsellor_id, unread_count")
        .eq("last_direction", "inbound")
        .gt("unread_count", 0);

      if (!data || (data as any[]).length === 0) { setUnrepliedByCC([]); return; }

      const groups: Record<string, { name: string; count: number }> = {};
      for (const c of data as any[]) {
        const key = c.counsellor_id || "__unassigned__";
        const name = c.counsellor_id
          ? (counsellorList.find(cc => cc.id === c.counsellor_id)?.name || "Unknown")
          : "Unassigned";
        if (!groups[key]) groups[key] = { name, count: 0 };
        groups[key].count += c.unread_count;
      }

      setUnrepliedByCC(
        Object.entries(groups)
          .filter(([, v]) => v.count > 0)
          .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      );
    })();
  }, [role, counsellorList]);

  // Auto-select conversation from URL param (notification deep-link)
  const phoneFromUrl = searchParams.get("phone");
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);
  useEffect(() => {
    if (!phoneFromUrl || conversations.length === 0) return;
    setDeepLinkNotFound(false);
    const normalized = phoneFromUrl.replace(/\D/g, "");
    const allSearchable = [...conversations, ...staffConvs];
    const match = allSearchable.find(c => c.phone === normalized || c.phone === phoneFromUrl);
    if (match) {
      if (match.has_inbound === false && !isOutboundMode) {
        navigate(`/whatsapp-inbox?mode=outbound&phone=${normalized}`, { replace: true });
        return;
      }
      setSelectedPhone(match.phone);
      setInboxTab("all");
    } else {
      setDeepLinkNotFound(true);
    }
  }, [searchParams, conversations.length, staffConvs.length]);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!selectedPhone) { setMessages([]); return; }
    (async () => {
      // Pick the active business pnid for filtering. "primary" matches the
      // most-used pnid + legacy NULL rows; otherwise exact match.
      const activePnid = businessNumber === "primary" ? primaryPnid : businessNumber;

      let q = supabase
        .from("whatsapp_messages" as any)
        .select("id, direction, content, message_type, status, template_key, media_url, created_at, business_phone_number_id")
        .eq("phone", selectedPhone)
        .order("created_at", { ascending: true })
        .limit(200);
      if (businessNumber === "primary") {
        if (activePnid) q = (q as any).or(`business_phone_number_id.is.null,business_phone_number_id.eq.${activePnid}`);
      } else {
        q = q.eq("business_phone_number_id", businessNumber);
      }
      const { data } = await q;
      if (data) setMessages(data as any);

      // Mark as read (scoped to the active inbox so the other inbox keeps its unread count)
      let upd = supabase
        .from("whatsapp_messages" as any)
        .update({ is_read: true, read_at: new Date().toISOString() } as any)
        .eq("phone", selectedPhone)
        .eq("direction", "inbound")
        .eq("is_read", false);
      if (businessNumber === "primary") {
        if (activePnid) upd = (upd as any).or(`business_phone_number_id.is.null,business_phone_number_id.eq.${activePnid}`);
      } else {
        upd = upd.eq("business_phone_number_id", businessNumber);
      }
      await upd;

      // Update local unread count
      setConversations(prev =>
        prev.map(c => c.phone === selectedPhone ? { ...c, unread_count: 0 } : c)
      );
    })();
  }, [selectedPhone, businessNumber, primaryPnid]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-inbox")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
      }, (payload: any) => {
        const msg = payload.new as Message & { phone: string; direction: string };
        // Add to current thread if matching
        if (msg.phone === selectedPhone) {
          setMessages(prev => [...prev, msg]);
        }
        // Update conversation list
        setConversations(prev => {
          const existing = prev.find(c => c.phone === msg.phone);
          if (existing) {
            return prev.map(c =>
              c.phone === msg.phone
                ? {
                    ...c,
                    last_message: msg.content,
                    last_direction: msg.direction,
                    last_message_at: msg.created_at,
                    unread_count: msg.direction === "inbound" && msg.phone !== selectedPhone
                      ? c.unread_count + 1 : c.unread_count,
                  }
                : c
            ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          }
          return prev;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedPhone]);

  const handleSendReply = async () => {
    if (!reply.trim() || !selectedPhone) return;
    setSending(true);

    const conv = conversations.find(c => c.phone === selectedPhone);

    const { error } = await supabase.functions.invoke("whatsapp-reply", {
      body: {
        phone: selectedPhone,
        message: reply.trim(),
        lead_id: conv?.lead_id || null,
      },
    });

    if (error) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    } else {
      setReply("");
    }
    setSending(false);
  };

  const KB_TEMPLATE_KEYS = new Set([
    "kb_apply_link", "kb_campus_addresses", "kb_rankings", "kb_approvals",
    "kb_scholarships", "kb_placements", "kb_eligibility", "kb_fee_structure", "kb_course_details",
  ]);

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !selectedPhone) return;
    setSendingTemplate(true);

    const conv = conversations.find(c => c.phone === selectedPhone);
    const leadName = conv?.lead_name || "Student";
    const previewText = getTemplatePreview(selectedTemplate);

    // KB quick-reply templates → send as freeform text via whatsapp-reply
    // These only work within the 24-hour WhatsApp conversation window
    if (KB_TEMPLATE_KEYS.has(selectedTemplate)) {
      const { data: replyData, error } = await supabase.functions.invoke("whatsapp-reply", {
        body: { phone: selectedPhone, message: previewText, lead_id: conv?.lead_id || null },
      });
      if (error || replyData?.error) {
        const errMsg = replyData?.error || error?.message || "Unknown error";
        if (errMsg.includes("window") || errMsg.includes("24") || errMsg.includes("expired")) {
          toast({ title: "24-hour window expired", description: "This message can only be sent within 24 hours of the lead's last reply. Use a Meta-approved template instead.", variant: "destructive" });
        } else {
          toast({ title: "Failed to send", description: errMsg, variant: "destructive" });
        }
      } else {
        toast({ title: "Message sent" });
        setSelectedTemplate(null);
        setShowTemplatePicker(false);
      }
      setSendingTemplate(false);
      return;
    }

    // Fetch lead details for accurate template params
    let courseName = "your selected course";
    let campusName = "NIMT campus";
    let leadSource = "enquiry";
    if (conv?.lead_id) {
      const { data: leadInfo } = await supabase
        .from("leads")
        .select("source, courses:course_id(name), campuses:campus_id(name)")
        .eq("id", conv.lead_id)
        .single();
      if (leadInfo) {
        courseName = (leadInfo.courses as any)?.name || courseName;
        campusName = (leadInfo.campuses as any)?.name || campusName;
        leadSource = leadInfo.source || leadSource;
      }
    }

    // Meta-approved templates via whatsapp-send
    let params: string[] = [];
    let buttonUrls: string[] | undefined;
    switch (selectedTemplate) {
      case "lead_welcome": params = [leadName, courseName, leadSource]; break;
      case "visit_confirmation": params = [leadName, "the scheduled date", campusName]; buttonUrls = ["1820424915210710582"]; break;
      case "visit_reminder_24hr": params = [leadName, "tomorrow", campusName]; break;
      case "application_received": params = [leadName, "N/A"]; break;
      case "fee_reminder": params = [leadName, "the pending amount", "the due date"]; break;
      case "course_details": params = [leadName, courseName]; break;
    }

    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { template_key: selectedTemplate, phone: selectedPhone, params, lead_id: conv?.lead_id || null, ...(buttonUrls ? { button_urls: buttonUrls } : {}) },
    });

    if (error) {
      const errBody = (error as any).data;
      let detail = error.message;
      if (errBody) {
        detail = typeof errBody === "string" ? errBody : errBody?.error || errBody?.meta_error || errBody?.message || JSON.stringify(errBody);
      }
      console.error("whatsapp-send template error:", { error, errBody, data });
      toast({ title: "Failed to send template", description: detail, variant: "destructive" });
    } else if (data?.error) {
      toast({ title: "Failed to send template", description: data.error, variant: "destructive" });
    } else {
      toast({ title: "Template sent" });
      setSelectedTemplate(null);
      setShowTemplatePicker(false);
    }
    setSendingTemplate(false);
  };

  // Build preview text with populated variables
  const getTemplatePreview = (templateKey: string): string => {
    const tmpl = INBOX_TEMPLATES.find(t => t.key === templateKey);
    if (!tmpl) return "";
    const conv = conversations.find(c => c.phone === selectedPhone);
    const leadName = conv?.lead_name || "Student";

    const values: Record<string, string> = {
      student_name: leadName,
      course_name: "your selected course",
      visit_date: "your scheduled date",
      campus_name: "our campus",
      application_id: "N/A",
      amount: "the pending amount",
      due_date: "the due date",
    };

    return tmpl.preview.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || `{{${key}}}`);
  };

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  // Resolve display name: lead name > staff name > phone
  // Course name → short acronym: "Bachelor of Business Administration (BBA)" → "BBA"
  const courseAcronym = (name: string | null) => {
    if (!name) return null;
    // Extract text in parentheses first: "Bachelor of Physiotherapy (BPT)" → "BPT"
    const paren = name.match(/\(([^)]+)\)/);
    if (paren) return paren[1];
    // Fallback: first letters of major words
    return name.split(/\s+/).filter(w => w.length > 2 && w[0] === w[0].toUpperCase()).map(w => w[0]).join("").slice(0, 4) || name.slice(0, 6);
  };

  // Format phone: strip 91 prefix for Indian numbers, keep ISD for others
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
    return phone;
  };
  const getDisplayName = (c: Conversation) => c.lead_name || staffNames[c.phone] || formatPhone(c.phone);
  const isStaffConv = (c: Conversation) => !c.lead_id && !!staffNames[c.phone];

  // Combine real conversations + synthetic staff entries
  const allStaffPhones = new Set(Object.keys(staffNames));
  const allConvs = (inboxTab === "staff"
    ? [...conversations.filter(c => !c.lead_id && allStaffPhones.has(c.phone)), ...staffConvs]
    : conversations).filter(matchesInbox);

  const NON_ADMISSION_ROLES = new Set(["job_applicant", "vendor", "other"]);
  const isOtherCategory = (c: Conversation) => c.lead_person_role && NON_ADMISSION_ROLES.has(c.lead_person_role);

  // Apply mode filter (inbox vs outbound) to get the working set
  const modeFiltered = allConvs.filter(c => {
    if (isOutboundMode) return c.has_inbound === false;
    // Inbox: only conversations with at least one inbound message
    // Synthetic staff entries (no real messages yet, has_inbound undefined) are excluded
    return c.has_inbound === true;
  });

  const filtered = modeFiltered.filter(c => {
    // Tab filter
    if (inboxTab === "all") { /* show everything */ }
    else if (inboxTab === "leads" && (!c.lead_id || isOtherCategory(c))) return false;
    else if (inboxTab === "staff" && !allStaffPhones.has(c.phone)) return false;
    else if (inboxTab === "jobs" && c.lead_person_role !== "job_applicant") return false;
    else if (inboxTab === "other" && c.lead_person_role !== "vendor" && c.lead_person_role !== "other") return false;
    // Unreplied-only mode (activated by clicking breakdown pill)
    if (unrepliedOnly && c.unread_count === 0) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      return getDisplayName(c).toLowerCase().includes(q) || c.phone.includes(q);
    }
    return true;
  }).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  const totalUnreadMsgs = modeFiltered.reduce((s, c) => s + c.unread_count, 0);
  const totalUnrepliedConvs = modeFiltered.filter(c => c.unread_count > 0).length;

  const leadConvs = modeFiltered.filter(c => c.lead_id && !isOtherCategory(c));
  const leadUnreplied = leadConvs.filter(c => c.unread_count > 0).length;
  const staffConvs2 = [...modeFiltered.filter(c => !c.lead_id && allStaffPhones.has(c.phone)), ...staffConvs];
  const staffUnreplied = staffConvs2.filter(c => c.unread_count > 0).length;
  const jobConvs = modeFiltered.filter(c => c.lead_person_role === "job_applicant");
  const jobUnreplied = jobConvs.filter(c => c.unread_count > 0).length;
  const otherConvs = modeFiltered.filter(c => c.lead_person_role === "vendor" || c.lead_person_role === "other");
  const otherUnreplied = otherConvs.filter(c => c.unread_count > 0).length;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const getConvDateLabel = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dDay.getTime() === today.getTime()) return "Today";
    if (dDay.getTime() === yesterday.getTime()) return "Yesterday";
    const diffDays = Math.floor((today.getTime() - dDay.getTime()) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Build grouped conversation list by date (most recent first, like WhatsApp)
  const groupedConvs: { label: string; items: Conversation[] }[] = [];
  const dateGroups: Record<string, Conversation[]> = {};
  for (const c of filtered) {
    const label = getConvDateLabel(c.last_message_at);
    if (!dateGroups[label]) dateGroups[label] = [];
    dateGroups[label].push(c);
  }
  for (const [label, items] of Object.entries(dateGroups)) {
    groupedConvs.push({ label, items });
  }

  const getMsgDateLabel = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dDay.getTime() === today.getTime()) return "Today";
    if (dDay.getTime() === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isOutboundMode ? "WhatsApp Outbound" : "WhatsApp Inbox"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOutboundMode
              ? `${filtered.length} outbound-only conversation${filtered.length !== 1 ? "s" : ""} (no reply received)`
              : totalUnreadMsgs > 0 || totalUnrepliedConvs > 0
                ? `${totalUnreadMsgs} unread message${totalUnreadMsgs !== 1 ? "s" : ""} · ${totalUnrepliedConvs} unreplied conversation${totalUnrepliedConvs !== 1 ? "s" : ""}`
                : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasOtherInbox && (
            <select
              value={businessNumber}
              onChange={e => { setBusinessNumber(e.target.value); setSelectedPhone(null); }}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50"
              title="Select inbox"
            >
              <option value="primary">Primary Inbox</option>
              {otherInboxes.map(o => (
                <option key={o.id} value={o.id}>+{o.label}</option>
              ))}
            </select>
          )}
          {isAdminRole(role) && (
            <button
              onClick={openBackfill}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
              title="Classify older messages by inbox"
            >
              <Settings className="h-3 w-3" />Backfill Inboxes
            </button>
          )}
          <button
            onClick={() => navigate(isOutboundMode ? "/whatsapp-inbox" : "/whatsapp-inbox?mode=outbound")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isOutboundMode
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {isOutboundMode ? <MessageSquare className="h-3 w-3" /> : <Send className="h-3 w-3" />}
            {isOutboundMode ? "Switch to Inbox" : "View Outbound"}
          </button>
        </div>
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <div className="flex h-[calc(100vh-180px)]">
          {/* Conversation list */}
          <div className={`w-full sm:w-80 lg:w-96 border-r border-border flex flex-col ${selectedPhone ? "hidden sm:flex" : "flex"}`}>
            {/* Filter pills */}
            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border">
              {([
                { key: "all" as const, label: "All", count: modeFiltered.length, unreplied: totalUnrepliedConvs, color: "bg-primary/10 text-primary border-primary/30" },
                { key: "leads" as const, label: "Admission", count: leadConvs.length, unreplied: leadUnreplied, color: "bg-blue-50 text-blue-700 border-blue-200" },
                { key: "staff" as const, label: "Staff", count: staffConvs2.length, unreplied: staffUnreplied, color: "bg-violet-50 text-violet-700 border-violet-200" },
                { key: "jobs" as const, label: "Jobs", count: jobConvs.length, unreplied: jobUnreplied, color: "bg-purple-50 text-purple-700 border-purple-200" },
                { key: "other" as const, label: "Other", count: otherConvs.length, unreplied: otherUnreplied, color: "bg-amber-50 text-amber-700 border-amber-200" },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setInboxTab(t.key)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border transition-colors ${
                    inboxTab === t.key ? `${t.color} ring-1 ring-current` : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {t.label} {t.count}{t.unreplied > 0 && (
                    <span className="ml-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-green-500 px-0.5 text-[8px] font-bold text-white">{t.unreplied}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Admin: counsellor filter row */}
            {isAdminRole(role) && (
              <div className="px-3 py-2 border-b border-border bg-muted/20">
                <select
                  value={counsellorFilter}
                  onChange={(e) => { setCounsellorFilter(e.target.value); setUnrepliedOnly(false); }}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                >
                  <option value="all">All Counsellors</option>
                  <option value="unassigned">Unassigned</option>
                  {counsellorList.map((cc) => (
                    <option key={cc.id} value={cc.id}>{cc.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </div>
            </div>

            {/* Admin: unreplied breakdown panel */}
            {isAdminRole(role) && unrepliedByCC.length > 0 && (
              <div className="border-b border-border bg-amber-50/60 dark:bg-amber-950/20">
                <button
                  onClick={() => setUnrepliedPanelOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
                >
                  <span>Unreplied by Counsellor</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${unrepliedPanelOpen ? "rotate-180" : ""}`} />
                </button>
                {unrepliedPanelOpen && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    {unrepliedByCC.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { setCounsellorFilter(item.id === "__unassigned__" ? "unassigned" : item.id); setUnrepliedOnly(true); }}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                          (item.id === "__unassigned__" && counsellorFilter === "unassigned") ||
                          (item.id !== "__unassigned__" && counsellorFilter === item.id)
                            ? "bg-amber-500 border-amber-500 text-white"
                            : "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/40"
                        }`}
                      >
                        {item.name}: {item.count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unreplied-only active indicator */}
            {unrepliedOnly && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/10 border-b border-amber-300/40">
                <span className="text-[10px] font-medium text-amber-700">Showing unreplied only</span>
                <button onClick={() => setUnrepliedOnly(false)} className="text-[10px] text-amber-700 hover:underline">
                  Show all
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No conversations yet</p>
              ) : (
                groupedConvs.map((group) => (
                  <div key={group.label}>
                    {/* Date section header */}
                    <div className="sticky top-0 z-10 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide border-b border-border/30 bg-muted/60 backdrop-blur-sm text-muted-foreground">
                      {group.label}
                    </div>
                    {group.items.map((c) => (
                      <button
                        key={c.phone}
                        onClick={() => setSelectedPhone(c.phone)}
                        className={`w-full text-left px-4 py-3 border-b border-border/40 hover:bg-muted/30 transition-colors ${selectedPhone === c.phone ? "bg-muted/50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-sm truncate ${c.unread_count > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                                {getDisplayName(c)}
                              </span>
                              {isStaffConv(c) && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-violet-300 text-violet-600 dark:text-violet-400">Staff</Badge>
                              )}
                              {c.lead_id && (!c.lead_person_role || c.lead_person_role === "lead" || c.lead_person_role === "applicant") && !isStaffConv(c) && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-blue-300 text-blue-600">Admission</Badge>
                              )}
                              {c.lead_person_role === "job_applicant" && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-purple-300 text-purple-600">Job</Badge>
                              )}
                              {c.lead_person_role === "vendor" && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-amber-300 text-amber-600">Vendor</Badge>
                              )}
                              {c.lead_person_role === "other" && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-gray-300 text-gray-500">Other</Badge>
                              )}
                              {c.unread_count > 0 && (
                                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-green-500 px-1 text-[9px] font-bold text-white">
                                  {c.unread_count}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {formatPhone(c.phone)}
                              {c.course_name && <span className="px-1 rounded bg-blue-50 text-blue-600 text-[8px] font-medium">{courseAcronym(c.course_name)}</span>}
                            </p>
                            <p className={`text-xs truncate mt-0.5 ${c.unread_count > 0 ? "font-medium text-foreground/80" : "text-muted-foreground"}`}>
                              {c.last_direction === "outbound" ? <span className="text-muted-foreground">You: </span> : ""}{(c.last_message || "[media]").replace(/\\n/g, " ")}
                            </p>
                          </div>
                          <span className={`text-[10px] whitespace-nowrap ${c.unread_count > 0 ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>
                            {formatTime(c.last_message_at)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Message thread */}
          <div className={`flex-1 flex flex-col ${!selectedPhone ? "hidden sm:flex" : "flex"}`}>
            {!selectedPhone ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  {deepLinkNotFound ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">Conversation not found</p>
                      <p className="text-xs text-muted-foreground mt-1">No messages found for {phoneFromUrl}. The message may have been unsupported (poll, location, etc.)</p>
                    </div>
                  ) : (
                    <p className="text-sm">Select a conversation</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8" onClick={() => setSelectedPhone(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{selectedConv?.lead_name || (selectedPhone ? formatPhone(selectedPhone) : "")}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      {selectedPhone ? formatPhone(selectedPhone) : ""}
                      {selectedConv?.course_name && (
                        <span
                          className="px-1.5 py-0 rounded bg-blue-100 text-blue-700 text-[9px] font-semibold cursor-pointer hover:bg-blue-200 transition-colors"
                          title={`${selectedConv.course_name} — click to copy`}
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedConv.course_name!); toast({ title: "Copied", description: selectedConv.course_name }); }}
                        >{courseAcronym(selectedConv.course_name)}</span>
                      )}
                    </p>
                  </div>
                  {selectedConv?.lead_id && (
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate(`/admissions/${selectedConv.lead_id}`)}>
                      View Lead <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                  {selectedConv?.lead_id && (
                    <Button
                      variant="ghost" size="sm"
                      className="gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={async () => {
                        if (!selectedConv?.lead_id) return;
                        await supabase.from("leads").update({ stage: "dnc" as any }).eq("id", selectedConv.lead_id);
                        await supabase.functions.invoke("whatsapp-reply", {
                          body: {
                            phone: selectedPhone,
                            message: "You have been added to our Do Not Contact list. We will not reach out to you via call or WhatsApp going forward. If this was a mistake, please reply START or call us at +91 9555192192.",
                            lead_id: selectedConv.lead_id,
                          },
                        });
                        toast({ title: "Lead marked DNC", description: "DNC notification sent via WhatsApp." });
                      }}
                    >
                      <Ban className="h-3 w-3" /> Mark DNC
                    </Button>
                  )}
                </div>
                {/* Category bar — visible for all conversations */}
                <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-muted/20">
                  <span className="text-[9px] text-muted-foreground mr-1 shrink-0">Mark as:</span>
                  {([
                    { value: "lead", label: "Admission", color: "border-blue-300 bg-blue-50 text-blue-700", activeColor: "ring-2 ring-blue-400 bg-blue-100" },
                    { value: "job_applicant", label: "Job Applicant", color: "border-purple-300 bg-purple-50 text-purple-700", activeColor: "ring-2 ring-purple-400 bg-purple-100" },
                    { value: "vendor", label: "Vendor", color: "border-amber-300 bg-amber-50 text-amber-700", activeColor: "ring-2 ring-amber-400 bg-amber-100" },
                    { value: "other", label: "Other", color: "border-gray-300 bg-gray-50 text-gray-600", activeColor: "ring-2 ring-gray-400 bg-gray-100" },
                  ] as const).map(cat => {
                    const currentRole = selectedConv?.lead_person_role || "lead";
                    const isActive = currentRole === cat.value;
                    return (
                      <button key={cat.value}
                        onClick={async () => {
                          if (!selectedPhone) return;
                          let leadId = selectedConv?.lead_id;

                          // Create a lead if one doesn't exist
                          if (!leadId) {
                            const { data: newLead } = await supabase.from("leads").insert({
                              phone: selectedPhone.startsWith("+") ? selectedPhone : `+${selectedPhone}`,
                              name: selectedConv?.lead_name || selectedPhone,
                              source: "whatsapp",
                              stage: cat.value === "lead" ? "new_lead" : "not_interested",
                              person_role: cat.value,
                            } as any).select("id").single();
                            if (newLead) {
                              leadId = newLead.id;
                              // Link conversation to lead
                              await supabase.from("whatsapp_messages" as any)
                                .update({ lead_id: leadId })
                                .eq("phone", selectedPhone.replace(/\D/g, ""));
                            }
                          } else {
                            await supabase.from("leads").update({ person_role: cat.value, category_locked: true } as any).eq("id", leadId);
                          }

                          setConversations(prev => prev.map(c =>
                            c.phone === selectedPhone ? { ...c, lead_person_role: cat.value, lead_id: leadId || c.lead_id } : c
                          ));

                          // Log training data for learning model
                          const inboundMsgs = messages
                            .filter(m => m.direction === "inbound" && m.content && m.content !== "[unsupported]")
                            .map(m => m.content)
                            .join(" ");
                          if (inboundMsgs) {
                            supabase.rpc("log_category_training" as any, {
                              _category: cat.value,
                              _message_text: inboundMsgs,
                              _phone: selectedPhone,
                            }).catch(() => {}); // non-blocking
                          }

                          toast({ title: "Categorized", description: `Marked as ${cat.label}` });
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-medium transition-all ${
                          isActive ? `${cat.color} ${cat.activeColor}` : `${cat.color} opacity-50 hover:opacity-100`
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {messages.map((m, i) => {
                    const prevMsg = messages[i - 1];
                    const showDateChip = !prevMsg || getMsgDateLabel(m.created_at) !== getMsgDateLabel(prevMsg.created_at);
                    return (
                    <div key={m.id}>
                      {showDateChip && (
                        <div className="flex justify-center my-2">
                          <span className="rounded-full bg-muted px-3 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                            {getMsgDateLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                    <div className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                        m.direction === "outbound"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      }`}>
                        {m.template_key && (
                          <p className="text-[9px] opacity-70 mb-0.5">Template: {m.template_key}</p>
                        )}
                        {/* Media rendering */}
                        {m.media_url && m.message_type === "image" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <img src={m.media_url} alt="image" className="rounded-lg max-w-[240px] mb-1" loading="lazy" />
                          )
                        ) : m.media_url && m.message_type === "video" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <video src={m.media_url} controls className="rounded-lg max-w-[240px] mb-1" />
                          )
                        ) : m.media_url && m.message_type === "audio" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <audio src={m.media_url} controls className="mb-1 max-w-[240px]" />
                          )
                        ) : m.media_url && m.message_type === "document" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm underline mb-1">
                              <FileDown className="h-4 w-4" /> Download document
                            </a>
                          )
                        ) : null}
                        {/* Text content / caption */}
                        {(m.content || (!m.media_url && m.message_type !== "text")) && (
                          <p className="text-sm whitespace-pre-wrap">{(m.content || `[${m.message_type}]`).replace(/\\n/g, "\n")}</p>
                        )}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[9px] opacity-60">
                            {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          </span>
                          {m.direction === "outbound" && (
                            <span className="text-[9px] opacity-50">{m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : "✓"}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Template picker panel */}
                {showTemplatePicker && (
                  <div className="border-t border-border bg-muted/30">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
                      <p className="text-xs font-semibold text-foreground">Send Template Message</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowTemplatePicker(false); setSelectedTemplate(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex max-h-[280px]">
                      {/* Template list */}
                      <div className="w-48 sm:w-56 border-r border-border/40 overflow-y-auto">
                        {INBOX_TEMPLATES.map((t) => (
                          <button
                            key={t.key}
                            onClick={() => setSelectedTemplate(t.key)}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/20 transition-colors ${
                              selectedTemplate === t.key ? "bg-primary/10" : "hover:bg-muted/50"
                            }`}
                          >
                            <p className={`text-xs font-medium ${selectedTemplate === t.key ? "text-primary" : "text-foreground"}`}>{t.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                          </button>
                        ))}
                      </div>
                      {/* Preview + send */}
                      <div className="flex-1 p-3 flex flex-col">
                        {selectedTemplate ? (
                          <>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Preview</p>
                            <div className="flex-1 overflow-y-auto">
                              <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/40 p-3">
                                <p className="text-xs text-green-900 dark:text-green-200 whitespace-pre-wrap leading-relaxed">
                                  {getTemplatePreview(selectedTemplate)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                              <p className="text-[10px] text-muted-foreground">
                                To: {selectedConv?.lead_name || selectedPhone}
                              </p>
                              <Button
                                size="sm"
                                className="gap-1.5 h-8 text-xs"
                                disabled={sendingTemplate}
                                onClick={handleSendTemplate}
                              >
                                {sendingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                Send Template
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground">
                            <p className="text-xs">Select a template to preview</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick replies panel */}
                {showQuickReplies && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Quick Replies</p>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowQuickReplies(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_REPLIES.map((qr) => (
                        <button
                          key={qr.label}
                          onClick={() => { setReply(qr.text); setShowQuickReplies(false); }}
                          className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          {qr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reply composer */}
                {(() => {
                  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
                  const withinWindow = lastInbound && (Date.now() - new Date(lastInbound.created_at).getTime()) < 24 * 60 * 60 * 1000;
                  return (
                    <div className="px-4 py-3 border-t border-border">
                      {!withinWindow && !showTemplatePicker && (
                        <div className="flex items-start gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 px-3 py-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-yellow-800 dark:text-yellow-300">
                            The 24-hour conversation window has expired. Use a template message to re-engage this contact.
                          </p>
                        </div>
                      )}
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleSendReply(); }}
                        className="flex items-center gap-2"
                      >
                        <Button
                          type="button"
                          variant={showTemplatePicker ? "default" : "outline"}
                          size="icon"
                          className="rounded-xl h-10 w-10 shrink-0"
                          onClick={() => { setShowTemplatePicker(!showTemplatePicker); setSelectedTemplate(null); }}
                          title="Send template message"
                        >
                          <LayoutTemplate className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant={showQuickReplies ? "default" : "outline"}
                          size="icon"
                          className="rounded-xl h-10 w-10 shrink-0"
                          onClick={() => setShowQuickReplies(!showQuickReplies)}
                          title="Quick replies"
                          disabled={!withinWindow}
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                        <input
                          type="text"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder={withinWindow ? "Type a message..." : "Window expired — use template"}
                          disabled={!withinWindow}
                          className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <Button type="submit" disabled={!withinWindow || !reply.trim() || sending} size="icon" className="rounded-xl h-10 w-10">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </form>
                      {withinWindow && !showTemplatePicker && !showQuickReplies && (
                        <p className="text-[10px] text-muted-foreground mt-1">Free-form replies only work within 24hrs of last inbound message. Use templates otherwise.</p>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Inbox backfill dialog */}
      <Dialog open={backfillOpen} onOpenChange={setBackfillOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-4 w-4" />Backfill Older Messages by Inbox
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              For threads still untagged, threads where UniOs ever sent a message go to <strong>primary</strong>;
              the rest are assumed to be on the <strong>secondary</strong> number (AiSensy etc.).
              Already-tagged threads aren't touched.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Primary phone_number_id</label>
              <input
                value={bfPrimaryPnid} onChange={e => setBfPrimaryPnid(e.target.value)}
                placeholder="e.g. 1234567890123"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <input
                value={bfPrimaryNumber} onChange={e => setBfPrimaryNumber(e.target.value)}
                placeholder="Display number, e.g. +91 90000 00000"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Secondary phone_number_id (AiSensy)</label>
              <input
                value={bfSecondaryPnid} onChange={e => setBfSecondaryPnid(e.target.value)}
                placeholder="e.g. 9876543210987"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <input
                value={bfSecondaryNumber} onChange={e => setBfSecondaryNumber(e.target.value)}
                placeholder="Display number"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {bfResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="font-semibold mb-1">Done</div>
                <div>Primary: {bfResult.primary_threads ?? 0} threads · {bfResult.primary_messages ?? 0} messages</div>
                <div>Secondary: {bfResult.secondary_threads ?? 0} threads · {bfResult.secondary_messages ?? 0} messages</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBackfillOpen(false)} disabled={bfRunning}>Close</Button>
            <Button onClick={runBackfill} disabled={bfRunning}>
              {bfRunning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Run Backfill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppInbox;
