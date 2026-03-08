import { Users, Search } from "lucide-react";

const Students = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage student records.</p>
        </div>
      </div>
      <div className="rounded-xl bg-card p-12 card-shadow text-center">
        <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="text-base font-semibold text-foreground">Student Directory</h3>
        <p className="text-sm text-muted-foreground mt-1">Student profiles and records will appear here once connected to a backend.</p>
      </div>
    </div>
  );
};

export default Students;
