import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, Loader2, Phone, Mail, Building2, ChevronRight,
  Users, Filter, UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Employee {
  user_id: string;
  display_name: string;
  phone: string;
  role: string;
  department: string | null;
  institution: string | null;
  campus: string | null;
  avatar_url: string | null;
}

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", counsellor: "Counsellor",
  accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Admin",
  office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
  ib_coordinator: "IB Coordinator",
};

const HrEmployeeDirectory = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone, role, department, institution, campus, avatar_url")
      .not("role", "in", "(student,parent)")
      .order("display_name");

    if (data) setEmployees(data as Employee[]);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = employees;
    if (roleFilter !== "all") result = result.filter(e => e.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.display_name?.toLowerCase().includes(q) ||
        e.phone?.includes(q) ||
        e.department?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [employees, search, roleFilter]);

  const roles = [...new Set(employees.map(e => e.role).filter(Boolean))].sort();
  const deptGroups = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      const dept = e.department || "Unassigned";
      map[dept] = (map[dept] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [employees]);

  const getInitials = (name: string) =>
    (name || "U").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  const avatarColors = ["bg-primary/15 text-primary", "bg-chart-2/15 text-chart-2", "bg-chart-3/15 text-chart-3", "bg-destructive/15 text-destructive", "bg-chart-5/15 text-chart-5"];
  const getAvatarColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employee Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">{employees.length} employees</p>
        </div>
      </div>

      {/* Department summary */}
      <div className="flex flex-wrap gap-2">
        {deptGroups.slice(0, 8).map(([dept, count]) => (
          <Badge key={dept} variant="outline" className="text-xs gap-1 cursor-default">
            <Building2 className="h-3 w-3" />
            {dept} ({count})
          </Badge>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search by name, phone, or department..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Roles</option>
          {roles.map(r => <option key={r} value={r}>{roleLabels[r] || r}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground text-sm">No employees found</div>
            ) : filtered.map((emp) => (
              <div key={emp.user_id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold ${getAvatarColor(emp.display_name)}`}>
                  {getInitials(emp.display_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{emp.display_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground capitalize">{(emp.role || "").replace(/_/g, " ")}</span>
                    {emp.department && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">{emp.department}</span>
                      </>
                    )}
                  </div>
                </div>
                {emp.phone && (
                  <a href={`tel:${emp.phone}`} className="text-muted-foreground hover:text-primary p-1">
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HrEmployeeDirectory;
