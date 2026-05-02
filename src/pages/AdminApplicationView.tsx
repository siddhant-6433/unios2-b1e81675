import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";

export default function AdminApplicationView() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any | null>(null);
  const [docs, setDocs] = useState<PreviewDoc[]>([]);

  useEffect(() => {
    if (!applicationId) return;
    (async () => {
      setLoading(true);
      const [{ data: appRow }, fnRes] = await Promise.all([
        supabase.from("applications").select("*").eq("application_id", applicationId).maybeSingle(),
        supabase.functions.invoke("list-app-docs", { body: { application_id: applicationId } }),
      ]);
      setApp(appRow);
      const list = ((fnRes.data as any)?.docs || []) as PreviewDoc[];
      setDocs(list);
      setLoading(false);
    })();
  }, [applicationId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!app) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Application not found.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/applications")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />Back
        </Button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 animate-fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">{app.full_name}</h1>
            <p className="text-xs font-mono text-primary">{app.application_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="text-[10px] border-0 bg-violet-100 text-violet-700">{app.status}</Badge>
          <Badge className="text-[10px] border-0 bg-emerald-100 text-emerald-700">{app.payment_status || "pending"}</Badge>
          {app.form_pdf_url && (
            <a href={app.form_pdf_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
              <FileText className="h-3.5 w-3.5" />Form PDF
            </a>
          )}
        </div>
      </div>

      <ApplicationPreview app={app} docs={docs} />
    </div>
  );
}
