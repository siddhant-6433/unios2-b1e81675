import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Phone, X } from "lucide-react";
import { PhoneInput, parsePhone, formatFullPhone, COUNTRY_CODES } from "@/components/ui/phone-input";
import { ButtonOrb } from "@/components/ui/thinking-orb";

interface EditPhoneDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: string;
  userName: string;
  /** Optional role of the user whose phone is being edited (shown in the header). */
  userRole?: string | null;
  currentPhone: string | null;
  /** Focus this user in the admin directory (correct tab + search) and open their profile. */
  onOpenProfile?: (user: {
    userId: string;
    name: string;
    role: string | null;
    phone: string | null;
    category: AdminUserCategory;
  }) => void;
}

type PhoneOwner = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
};

/** Last 10 digits for India-centric comparison (also works for exact full E.164 when equal length). */
export function phoneMatchKey(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return "No role";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Which Users & Roles sub-tab shows this profile (mirrors admin_user_directory).
 * No role → Leads & Applicants — often the “ghost” profile left after OTP login.
 */
export type AdminUserCategory =
  | "employees"
  | "consultants"
  | "academic_partners"
  | "publishers"
  | "families"
  | "leads";

export function adminUserCategoryForRole(role: string | null | undefined): AdminUserCategory {
  if (!role) return "leads";
  if (role === "consultant") return "consultants";
  if (role === "academic_partner" || role === "academic_partner_offer_letter") return "academic_partners";
  if (role === "publisher") return "publishers";
  if (role === "student" || role === "parent") return "families";
  return "employees";
}

export function adminUserCategoryLabel(category: AdminUserCategory): string {
  switch (category) {
    case "employees": return "Employees";
    case "consultants": return "Consultants";
    case "academic_partners": return "Academic Partners";
    case "publishers": return "Publishers";
    case "families": return "Students & Families";
    case "leads": return "Leads & Applicants";
  }
}

/** Deep link into admin user management focused on a user. */
export function adminUserProfileHref(userId: string, opts?: { category?: AdminUserCategory; search?: string }): string {
  const params = new URLSearchParams({ tab: "users", user: userId });
  if (opts?.category) params.set("category", opts.category);
  if (opts?.search) params.set("q", opts.search);
  return `/admin?${params.toString()}`;
}

async function findPhoneOwners(normalizedPhone: string, excludeUserId: string): Promise<PhoneOwner[]> {
  const key = phoneMatchKey(normalizedPhone);
  if (!key) return [];

  // Exact match first (what the unique index enforces), then loose ILIKE on trailing digits
  // for cases where another profile stores a different formatting of the same number.
  const orFilter = [
    `phone.eq.${normalizedPhone}`,
    `phone.eq.${key}`,
    `phone.eq.+91${key}`,
    `phone.eq.91${key}`,
    `phone.ilike.%${key}`,
  ].join(",");

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, email, phone")
    .or(orFilter)
    .neq("user_id", excludeUserId)
    .limit(10);

  if (error) throw error;

  const rows = (profiles || []).filter((p) => phoneMatchKey(p.phone) === key);
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", userIds);

  const roleByUser = new Map((roles || []).map((r) => [r.user_id, r.role as string]));

  return rows.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    email: r.email,
    phone: r.phone,
    role: roleByUser.get(r.user_id) ?? null,
  }));
}

const EditPhoneDialog = ({
  open,
  onClose,
  onSuccess,
  userId,
  userName,
  userRole = null,
  currentPhone,
  onOpenProfile,
}: EditPhoneDialogProps) => {
  const [fullPhone, setFullPhone] = useState(currentPhone || "");
  const [saving, setSaving] = useState(false);
  const [owners, setOwners] = useState<PhoneOwner[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setFullPhone(currentPhone || "");
      setOwners(null);
    }
  }, [open, currentPhone]);

  if (!open) return null;

  const parsed = parsePhone(fullPhone);
  const country = COUNTRY_CODES.find((c) => c.code === parsed.countryCode) || COUNTRY_CODES[0];
  const digitsOnly = parsed.number.replace(/\D/g, "");
  const isValid = digitsOnly.length === country.digits;
  const normalizedPhone = formatFullPhone(parsed.countryCode, digitsOnly);

  const ownerName = (o: PhoneOwner) => o.display_name?.trim() || o.email || "Unknown user";
  const ownerLabel = (o: PhoneOwner) => {
    const role = o.role ? ` (${formatRoleLabel(o.role)})` : "";
    return `${ownerName(o)}${role}`;
  };

  const openOwnerProfile = (o: PhoneOwner) => {
    const category = adminUserCategoryForRole(o.role);
    if (onOpenProfile) {
      onOpenProfile({
        userId: o.user_id,
        name: ownerName(o),
        role: o.role,
        phone: o.phone,
        category,
      });
      return;
    }
    // Fallback: navigate via full page load of deep link
    window.location.assign(adminUserProfileHref(o.user_id, {
      category,
      search: o.phone || ownerName(o),
    }));
  };

  const applyPhone = async (reassignFrom: PhoneOwner[] = []) => {
    setSaving(true);
    try {
      // Free the number from other profiles first when user confirmed reassignment.
      for (const owner of reassignFrom) {
        const { error: clearErr } = await supabase
          .from("profiles")
          .update({ phone: null })
          .eq("user_id", owner.user_id);
        if (clearErr) throw clearErr;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ phone: normalizedPhone })
        .eq("user_id", userId);
      if (error) {
        if (error.message?.includes("profiles_phone_unique") || error.code === "23505") {
          const again = await findPhoneOwners(normalizedPhone, userId);
          setOwners(again);
          throw new Error(
            again.length
              ? `This number is already used by ${again.map(ownerLabel).join(", ")}. Clear it from them first or reassign below.`
              : "This number is already used by another profile.",
          );
        }
        throw error;
      }

      toast({
        title: "Phone updated",
        description: reassignFrom.length
          ? `Moved ${normalizedPhone} from ${reassignFrom.map(ownerLabel).join(", ")} to ${userName}.`
          : `Mobile number set to ${normalizedPhone} for ${userName}.`,
      });
      setOwners(null);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast({
        title: "Invalid number",
        description: `Enter exactly ${country.digits} digits for ${country.name}.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const existing = await findPhoneOwners(normalizedPhone, userId);
      if (existing.length > 0) {
        setOwners(existing);
        toast({
          title: "Number already in use",
          description: `Used by ${existing.map(ownerLabel).join(", ")}. Open their profile or reassign below.`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      setOwners(null);
      await applyPhone([]);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-card card-shadow p-6 mx-4 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Edit Mobile Number</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1">
          <p className="text-sm font-semibold text-foreground">{userName}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current role</span>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {formatRoleLabel(userRole)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground pt-0.5">
            Used for <span className="font-semibold text-foreground">WhatsApp OTP login</span>. Must be unique across staff, applicants, and consultants — deleting a lead does not free a profile phone.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Mobile Number <span className="text-destructive">*</span>
            </label>
            <PhoneInput value={fullPhone} onChange={(v) => { setFullPhone(v); setOwners(null); }} required />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {digitsOnly.length}/{country.digits} digits
              {isValid && <span className="text-primary ml-1">✓ Valid</span>}
            </p>
          </div>

          {owners && owners.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-destructive">Already linked to:</p>
              <ul className="space-y-2">
                {owners.map((o) => {
                  const category = adminUserCategoryForRole(o.role);
                  return (
                  <li
                    key={o.user_id}
                    className="rounded-lg border border-destructive/15 bg-background/80 px-2.5 py-2 text-xs text-foreground"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold truncate">{ownerName(o)}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Role</span>
                          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                            {formatRoleLabel(o.role)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Find under</span>
                          <span className="inline-flex items-center rounded-md bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info-foreground">
                            {adminUserCategoryLabel(category)}
                          </span>
                        </div>
                        {!o.role && (
                          <p className="text-[10px] text-warning-foreground">
                            No UniOs role — not under Employees. Search may miss soft-deleted accounts; use Reassign below to free the number without finding them in the list.
                          </p>
                        )}
                        {o.email && (
                          <p className="text-[10px] text-muted-foreground truncate">{o.email}</p>
                        )}
                        {o.phone && (
                          <p className="text-[10px] text-muted-foreground">Stored as {o.phone}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openOwnerProfile(o)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/5"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Go to user
                        </button>
                        <Link
                          to={adminUserProfileHref(o.user_id, {
                            category,
                            search: o.phone || ownerName(o),
                          })}
                          onClick={onClose}
                          className="inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Admin link
                        </Link>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
              <p className="text-[10px] text-muted-foreground">
                Reassign clears the number from those profile(s) and sets it on {userName}. Their WhatsApp OTP login will stop until they get a new number.
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={() => applyPhone(owners)}
                className="w-full rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
              >
                {saving ? "Reassigning…" : `Reassign number to ${userName}`}
              </button>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !isValid}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <ButtonOrb state="working" onFilled /> : <Phone className="h-4 w-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditPhoneDialog;
