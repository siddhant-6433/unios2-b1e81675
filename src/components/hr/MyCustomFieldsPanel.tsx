// My custom fields — employee self-service, meant to be embedded in My HR.
//
// Read-only. The my_employee_fields() RPC resolves the signed-in user to their
// own employee profile and returns one row per active field with the value they
// have recorded (or null). Because the RPC does the identity join in SQL there is
// nothing to look up client-side, and a user with no linked employee record
// simply gets an empty set — which we render as a plain empty state.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";
import {
  fieldTypeLabel,
  formatFieldValue,
  sortDefs,
  type FieldType,
} from "@/lib/customFields";

interface MyFieldRow {
  field_id: string;
  key: string;
  label: string;
  field_type: FieldType;
  value: string | null;
  display_order: number;
}

export function MyCustomFieldsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MyFieldRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await (supabase.rpc("my_employee_fields" as never) as never);
    if (res.error) {
      toast({ title: "Could not load your details", description: res.error.message, variant: "destructive" });
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(sortDefs((res.data as MyFieldRow[] | null) ?? []));
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PageLoader className="min-h-[40vh]" label="Loading your details…" />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No additional details on file</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          HR has not recorded any custom fields for your profile yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        These are maintained by HR. Ask HR if something looks wrong.
      </p>
      <div className="rounded-xl bg-card card-shadow overflow-hidden divide-y divide-border">
        {rows.map((row) => (
          <div key={row.field_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm text-foreground truncate">{row.label || row.key}</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                {fieldTypeLabel(row.field_type)}
              </Badge>
            </div>
            <span className="text-sm font-medium text-foreground text-right break-words">
              {formatFieldValue(row, row.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MyCustomFieldsPanel;
