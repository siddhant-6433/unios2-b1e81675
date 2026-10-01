import { Megaphone } from "lucide-react";
import { AnnouncementsPanel } from "@/components/hr/AnnouncementsPanel";

const HrAnnouncements = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Megaphone className="h-6 w-6" /> Announcements
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publish to everyone or a set of roles, pin what matters, and see who has read it.
        </p>
      </div>
      <AnnouncementsPanel />
    </div>
  );
};

export default HrAnnouncements;
