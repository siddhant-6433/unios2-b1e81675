import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  UserCheck, Check, X, Loader2, Camera, Clock, Trash2, RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface FaceRegistration {
  id: string;
  user_id: string;
  image_url: string;
  status: string;
  created_at: string;
  profiles: { display_name: string; phone: string } | null;
}

export default function FaceApprovalPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [registrations, setRegistrations] = useState<FaceRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { fetchRegistrations(); }, []);

  const fetchRegistrations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employee_face_registrations")
      .select("id, user_id, image_url, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Face reg fetch error:", error.message);
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map((r: any) => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles").select("user_id, display_name, phone").in("user_id", userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

      setRegistrations(data.map((r: any) => ({
        ...r,
        profiles: profileMap.get(r.user_id) || { display_name: "Unknown", phone: "" },
      })));
    } else {
      setRegistrations([]);
    }
    setLoading(false);
  };

  const handleApprove = async (id: string) => {
    setProcessing(id);
    const { error } = await supabase.from("employee_face_registrations")
      .update({ status: "approved", approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Approved" });
    setProcessing(null);
    fetchRegistrations();
  };

  const handleReject = async (id: string) => {
    setProcessing(id);
    const { error } = await supabase.from("employee_face_registrations")
      .update({ status: "rejected", rejected_reason: "Rejected by admin" })
      .eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Rejected", description: "Employee will need to re-register." });
    setProcessing(null);
    fetchRegistrations();
  };

  const handleDelete = async (reg: FaceRegistration) => {
    if (!confirm(`Delete face registration for ${reg.profiles?.display_name}? They will need to register again.`)) return;
    setProcessing(reg.id);
    const { error } = await supabase.from("employee_face_registrations").delete().eq("id", reg.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Deleted", description: "Registration removed. Employee can re-register." });
    setProcessing(null);
    fetchRegistrations();
  };

  const handleReset = async (reg: FaceRegistration) => {
    setProcessing(reg.id);
    const { error } = await supabase.from("employee_face_registrations")
      .update({ status: "pending", approved_by: null, approved_at: null })
      .eq("id", reg.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Reset to pending" });
    setProcessing(null);
    fetchRegistrations();
  };

  const pending = registrations.filter(r => r.status === "pending");
  const approved = registrations.filter(r => r.status === "approved");
  const rejected = registrations.filter(r => r.status === "rejected");

  if (loading) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return "bg-pastel-green text-foreground/80";
    if (status === "rejected") return "bg-pastel-red text-foreground/80";
    return "bg-pastel-yellow text-foreground/80";
  };

  const renderCard = (reg: FaceRegistration) => (
    <Card key={reg.id} className={`shadow-none overflow-hidden ${reg.status === "pending" ? "border-warning/40" : "border-border/60"}`}>
      <div className="aspect-[4/3] bg-muted relative">
        {reg.image_url ? (
          <img src={reg.image_url} alt={reg.profiles?.display_name || "Face"} className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Camera className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge className={`text-[10px] border-0 ${statusBadge(reg.status)}`}>{reg.status}</Badge>
        </div>
      </div>
      <CardContent className="p-4">
        <p className="text-sm font-semibold text-foreground">{reg.profiles?.display_name || "Unknown"}</p>
        <p className="text-xs text-muted-foreground">{reg.profiles?.phone || "—"}</p>
        <p className="text-[10px] text-muted-foreground font-mono mt-1">ID: {reg.user_id.slice(0, 8).toUpperCase()}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {new Date(reg.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>

        <div className="flex gap-2 mt-3">
          {reg.status === "pending" && (
            <>
              <Button size="sm" onClick={() => handleApprove(reg.id)} disabled={processing === reg.id} className="flex-1 gap-1 h-8">
                {processing === reg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleReject(reg.id)} disabled={processing === reg.id} className="flex-1 gap-1 h-8">
                <X className="h-3 w-3" /> Reject
              </Button>
            </>
          )}
          {reg.status === "approved" && (
            <Button size="sm" variant="outline" onClick={() => handleReset(reg.id)} disabled={processing === reg.id} className="flex-1 gap-1 h-8">
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => handleDelete(reg)} disabled={processing === reg.id}
            className="gap-1 h-8 text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" /> Pending Approval ({pending.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map(renderCard)}
          </div>
        </div>
      )}

      {/* Approved */}
      {approved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-success" /> Registered ({approved.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {approved.map(renderCard)}
          </div>
        </div>
      )}

      {/* Rejected */}
      {rejected.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <X className="h-4 w-4 text-destructive" /> Rejected ({rejected.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rejected.map(renderCard)}
          </div>
        </div>
      )}

      {/* Empty */}
      {registrations.length === 0 && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="py-12 text-center">
            <Camera className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No face registrations yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
