// Employee profile editor, modal form.
//
// Opened from the admin Team tab (by auth user). The HR directory now links to
// /employee/:id instead — a person deserves a URL — but this stays for the admin
// panel, where the employee record is a detail of a login rather than the subject.
//
// All the state and every form field live in employeeProfileForm; this file is
// only the modal chrome around them.

import { useState } from "react";
import { X, Save, Camera, LogOut } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MarkExitDialog } from "@/components/hr/MarkExitDialog";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { useEmployeeProfile, EmployeeProfileTabs } from "@/components/hr/employeeProfileForm";

interface EmployeeProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Auth user id. Absent for employees imported without a login. */
  userId?: string;
  /** employee_profiles.id. Preferred when known; required for login-less rows. */
  employeeProfileId?: string;
  userName: string;
  readOnly?: boolean;
}

const EmployeeProfileDialog = ({
  open, onClose, onSuccess, userId, employeeProfileId, userName, readOnly = false,
}: EmployeeProfileDialogProps) => {
  const [exitOpen, setExitOpen] = useState(false);
  const ctx = useEmployeeProfile({ enabled: open, userId, employeeProfileId, userName, readOnly, onSuccess });
  const {
    profile, linkedUserId, loading, saving, isNew,
    uploadingPhoto, photoStage, handlePhoto, handleSave, editable,
  } = ctx;

  if (!open) return null;

  const initials = (profile.display_name || userName || "U")
    .split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {/* Radix portals this to <body>. The hand-rolled `fixed inset-0` version it
          replaced was positioned by the nearest transformed ancestor instead of the
          viewport — the HR directory page carries `animate-fade-in`, whose keyframes
          set a transform — so the modal opened near the bottom of a long list. */}
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            {profile.photo_url ? (
              <img
                src={profile.photo_url}
                alt={profile.display_name || userName}
                className="h-14 w-14 rounded-xl object-cover border border-border bg-white"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {initials}
              </div>
            )}
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">Employee Profile</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {profile.display_name || userName}
                {!linkedUserId && <span className="ml-2 text-muted-foreground/70">· no login linked</span>}
              </p>
              {editable && (
                <label
                  className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    uploadingPhoto || !profile.id
                      ? "text-muted-foreground/60 cursor-not-allowed"
                      : "text-foreground hover:bg-muted cursor-pointer"
                  }`}
                  title={profile.id ? undefined : "Save the profile once before adding a photo"}
                >
                  {uploadingPhoto ? <ButtonOrb state="working" /> : <Camera className="h-3.5 w-3.5" />}
                  {photoStage === "processing"
                    ? "Removing background…"
                    : photoStage === "uploading"
                      ? "Uploading…"
                      : profile.photo_url ? "Change photo" : "Add photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploadingPhoto || !profile.id}
                    onChange={handlePhoto}
                  />
                </label>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editable && profile.id && !isNew && (
              <button
                onClick={() => setExitOpen(true)}
                title="Record a resignation or termination"
                className="flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
              >
                <LogOut className="h-4 w-4" /> Mark exit
              </button>
            )}
            {editable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? <ButtonOrb state="working" onFilled /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : "Save"}
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <OrbLoader state="working" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <fieldset disabled={!editable} className="p-6 disabled:opacity-100 w-full">
              <EmployeeProfileTabs ctx={ctx} />
            </fieldset>
          </div>
        )}
      </DialogContent>

      <MarkExitDialog
        open={exitOpen}
        onOpenChange={setExitOpen}
        employee={profile.id ? { id: profile.id, name: profile.display_name || userName, employeeNumber: profile.employee_number } : null}
        onSuccess={() => { onSuccess?.(); onClose(); }}
      />
    </Dialog>
  );
};

export default EmployeeProfileDialog;
