import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Users, Plus, Loader2, Trash2, UserPlus, Crown, X, ChevronDown, ChevronRight,
} from "lucide-react";

interface Team {
  id: string;
  name: string;
  leader_id: string;
  leader_name?: string;
  members: { id: string; user_id: string; display_name: string }[];
}

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
}

export default function TeamManagement() {
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newLeader, setNewLeader] = useState("");
  const [creating, setCreating] = useState(false);

  // Add member
  const [addMemberTeam, setAddMemberTeam] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [teamsRes, membersRes, profilesRes] = await Promise.all([
      supabase.from("teams").select("*").order("created_at", { ascending: false }),
      supabase.from("team_members").select("*"),
      supabase.from("profiles").select("id, user_id, display_name"),
    ]);

    const allProfiles = profilesRes.data || [];
    setProfiles(allProfiles);

    const allMembers = membersRes.data || [];
    const teamList: Team[] = (teamsRes.data || []).map((t: any) => {
      const leader = allProfiles.find(p => p.id === t.leader_id);
      const members = allMembers
        .filter(m => m.team_id === t.id)
        .map(m => {
          const profile = allProfiles.find(p => p.user_id === m.user_id);
          return { id: m.id, user_id: m.user_id, display_name: profile?.display_name || "Unknown" };
        });
      return { ...t, leader_name: leader?.display_name || "Unknown", members };
    });

    setTeams(teamList);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newLeader) return;
    setCreating(true);
    const { error } = await supabase.from("teams").insert({ name: newName.trim(), leader_id: newLeader });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Team created" });
      setNewName(""); setNewLeader(""); setShowCreate(false);
      await fetchAll();
    }
    setCreating(false);
  };

  const handleDelete = async (teamId: string) => {
    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Team deleted" }); fetchAll(); }
  };

  const handleAddMember = async () => {
    if (!addMemberTeam || !selectedMember) return;
    setAddingMember(true);
    const { error } = await supabase.from("team_members").insert({
      team_id: addMemberTeam, user_id: selectedMember,
    });
    if (error) {
      toast({ title: "Error", description: error.code === "23505" ? "User is already in this team" : error.message, variant: "destructive" });
    } else {
      toast({ title: "Member added" });
      setSelectedMember("");
      setAddMemberTeam(null);
      fetchAll();
    }
    setAddingMember(false);
  };

  const handleRemoveMember = async (memberId: string) => {
    await supabase.from("team_members").delete().eq("id", memberId);
    toast({ title: "Member removed" });
    fetchAll();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Teams</h2>
          <p className="text-sm text-muted-foreground">Organize counsellors into teams with leaders</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" /> Create Team</Button>
      </div>

      {teams.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-16 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No teams created yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teams.map(team => {
            const isExpanded = expandedTeam === team.id;
            return (
              <Card key={team.id} className="border-border/60 shadow-none">
                <CardContent className="p-0">
                  {/* Team header */}
                  <div
                    className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{team.name}</h3>
                        <Badge variant="secondary" className="text-[10px]">{team.members.length} members</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Crown className="h-3 w-3 text-amber-500" />
                        <span className="text-xs text-muted-foreground">{team.leader_name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAddMemberTeam(team.id)}>
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(team.id)}>
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  </div>

                  {/* Members list */}
                  {isExpanded && (
                    <div className="border-t border-border/40 px-5 py-3">
                      {team.members.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">No members added yet</p>
                      ) : (
                        <div className="space-y-2">
                          {team.members.map(m => (
                            <div key={m.id} className="flex items-center justify-between py-1.5">
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                                  {(m.display_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                                </div>
                                <span className="text-sm text-foreground">{m.display_name}</span>
                              </div>
                              <button onClick={() => handleRemoveMember(m.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Team Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Team</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Team Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Engineering Admissions" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Team Leader</label>
              <select value={newLeader} onChange={e => setNewLeader(e.target.value)} className={inputCls}>
                <option value="">Select a team leader...</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.display_name || "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim() || !newLeader} className="gap-1.5">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={!!addMemberTeam} onOpenChange={() => setAddMemberTeam(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Select User</label>
              <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} className={inputCls}>
                <option value="">Select a user...</option>
                {profiles.map(p => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name || "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddMemberTeam(null)}>Cancel</Button>
              <Button onClick={handleAddMember} disabled={addingMember || !selectedMember} className="gap-1.5">
                {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
