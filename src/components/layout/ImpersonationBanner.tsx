import { useAuth } from "@/contexts/AuthContext";
import { Eye, X } from "lucide-react";

export function ImpersonationBanner() {
  const { isImpersonating, impersonatingName, role, stopImpersonating } = useAuth();

  if (!isImpersonating) return null;

  const roleLabel = role ? role.replace(/_/g, " ") : "no role";

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        Viewing as <strong>{impersonatingName}</strong> ({roleLabel})
      </span>
      <button
        onClick={stopImpersonating}
        className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-950/20 px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-950/30 transition-colors"
      >
        <X className="h-3 w-3" />
        Stop Impersonating
      </button>
    </div>
  );
}
