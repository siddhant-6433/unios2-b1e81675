import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

const BEACON_CAMPUS_ID = "9bb6b4cc-c992-4af1-b9d3-384537a510c8";
const MIRAI_CAMPUS_ID  = "c0000002-0000-0000-0000-000000000001";

function brandLabel(campusId: string | null | undefined): string {
  if (campusId === MIRAI_CAMPUS_ID)  return "Mirai (IB)";
  if (campusId === BEACON_CAMPUS_ID) return "NIMT Beacon (CBSE)";
  return "Linked";
}

export function MirrorLeadCard({ mirrorLeadId }: { mirrorLeadId: string }) {
  const [m, setM] = useState<{
    id: string;
    stage: string;
    campus_id: string | null;
    counsellor_name: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("leads")
        .select("id, stage, campus_id, counsellor:counsellor_id(name)")
        .eq("id", mirrorLeadId)
        .maybeSingle();
      if (cancelled || !data) return;
      setM({
        id: data.id,
        stage: data.stage,
        campus_id: data.campus_id,
        counsellor_name: (data.counsellor as any)?.name ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [mirrorLeadId]);

  if (!m) return null;

  const stageLabel = m.stage.replace(/_/g, " ");
  const counsellorLabel = m.counsellor_name ?? "Unassigned";

  return (
    <Card className="border-border/60 bg-muted/30">
      <CardContent className="p-3 flex items-center gap-3">
        <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Linked {brandLabel(m.campus_id)} counterpart
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">{stageLabel}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            Counsellor: {counsellorLabel}
          </p>
        </div>
        <Link
          to={`/leads/${m.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
        >
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
