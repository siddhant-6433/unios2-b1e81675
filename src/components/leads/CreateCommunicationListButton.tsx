import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  canAccessDirectoryAudience,
  type DirectoryAudience,
} from "@/lib/directoryCommunicationLists";

export function CreateCommunicationListButton(
  { audience, label = "Create Communication List", onCreated }: {
    audience: DirectoryAudience;
    label?: string;
    onCreated?: (listId: string) => void;
  },
) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { role, permissions } = useAuth();
  const { toast } = useToast();
  if (!canAccessDirectoryAudience(audience, role, permissions)) return null;
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { data, error } = await supabase.rpc(
            "ensure_directory_communication_list",
            { _audience: audience },
          );
          if (error) throw error;
          navigate(`/lists?listId=${data}`);
          onCreated?.(data);
        } catch (error) {
          toast({
            title: "Could not create communication list",
            description: (error as Error).message,
            variant: "destructive",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Creating…" : label}
    </Button>
  );
}
