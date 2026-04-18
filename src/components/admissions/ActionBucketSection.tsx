import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { ActionLeadRow, type BucketVariant } from "./ActionLeadRow";
import type { ActionLead } from "@/hooks/useActionCenter";

interface ActionBucketSectionProps {
  title: string;
  icon: string; // emoji
  color: string; // tailwind border color class e.g. "border-red-500"
  headerBg: string; // tailwind bg class for header
  variant: BucketVariant;
  leads: ActionLead[];
  defaultCollapsed?: boolean;
  storageKey: string;
  onCall?: (lead: ActionLead) => void;
  onCompleteVisit?: (lead: ActionLead) => void;
  onViewAll?: () => void;
}

const MAX_VISIBLE = 3;

export function ActionBucketSection({
  title,
  icon,
  color,
  headerBg,
  variant,
  leads,
  defaultCollapsed = false,
  storageKey,
  onCall,
  onCompleteVisit,
  onViewAll,
}: ActionBucketSectionProps) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(`action-bucket-${storageKey}`);
    return saved !== null ? saved === "true" : defaultCollapsed;
  });

  useEffect(() => {
    localStorage.setItem(`action-bucket-${storageKey}`, String(collapsed));
  }, [collapsed, storageKey]);

  const visibleLeads = leads.slice(0, MAX_VISIBLE);
  const hasMore = leads.length > MAX_VISIBLE;

  return (
    <div className={`rounded-xl border ${color} border-l-4 bg-card overflow-hidden`}>
      {/* Header */}
      <button
        className={`w-full flex items-center gap-2 px-3 py-2 ${headerBg} hover:brightness-95 dark:hover:brightness-110 transition-all`}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</span>
        <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[10px] font-bold text-foreground">
          {leads.length}
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div>
          {leads.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-5 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-xs font-medium">All caught up!</span>
            </div>
          ) : (
            <>
              {visibleLeads.map((lead) => (
                <ActionLeadRow
                  key={lead.id}
                  lead={lead}
                  variant={variant}
                  onCall={onCall}
                  onCompleteVisit={onCompleteVisit}
                />
              ))}
              {hasMore && (
                <button
                  className="w-full py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/50 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onViewAll?.(); }}
                >
                  View all {leads.length} →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
