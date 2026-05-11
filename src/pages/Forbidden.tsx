import { ShieldOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Forbidden() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
      <ShieldOff className="h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold text-foreground">Access Denied</h1>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        You don't have permission to view this page. Contact your administrator if you think this is a mistake.
      </p>
      <button
        onClick={() => navigate(-1)}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
      >
        Go Back
      </button>
    </div>
  );
}
