// Locations settings.
//
// Two related tables:
//   • business_units — the commercial divisions (e.g. "NIMT", "Mirai") that a
//     legal entity runs and an employee can be posted to.
//   • hr_locations   — physical places, each optionally tied to a campus, a
//     business unit and a legal entity.
//
// Both are read by the directory/hiring venue picker, so this is where the org
// geography is kept truthful.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, MapPin, Pencil, Plus } from "lucide-react";

interface HrLocation {
  id: string;
  name: string;
  address: string | null;
  campus_id: string | null;
  business_unit_id: string | null;
  legal_entity_id: string | null;
  timezone: string;
  is_active: boolean;
}

interface BusinessUnit {
  id: string;
  name: string;
  code: string | null;
  legal_entity_id: string | null;
  is_active: boolean;
}

interface Ref {
  id: string;
  name: string;
}

const EMPTY_LOCATION = {
  name: "",
  address: "",
  campus_id: "",
  business_unit_id: "",
  legal_entity_id: "",
  timezone: "Asia/Kolkata",
  is_active: true,
};

const EMPTY_UNIT = {
  name: "",
  code: "",
  legal_entity_id: "",
  is_active: true,
};

export function LocationsPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "employees_edit");

  const [locations, setLocations] = useState<HrLocation[]>([]);
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [campuses, setCampuses] = useState<Ref[]>([]);
  const [entities, setEntities] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [locationOpen, setLocationOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<HrLocation | null>(null);
  const [locationForm, setLocationForm] = useState({ ...EMPTY_LOCATION });

  const [unitOpen, setUnitOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<BusinessUnit | null>(null);
  const [unitForm, setUnitForm] = useState({ ...EMPTY_UNIT });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [l, u, c, e] = await Promise.all([
      (supabase as any).from("hr_locations")
        .select("id, name, address, campus_id, business_unit_id, legal_entity_id, timezone, is_active")
        .order("name"),
      (supabase as any).from("business_units")
        .select("id, name, code, legal_entity_id, is_active")
        .order("name"),
      supabase.from("campuses").select("id, name").order("name"),
      supabase.from("legal_entities").select("id, name").order("name"),
    ]);
    setLocations((l.data as HrLocation[]) ?? []);
    setUnits((u.data as BusinessUnit[]) ?? []);
    setCampuses((c.data as Ref[]) ?? []);
    setEntities((e.data as Ref[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refName = useMemo(() => {
    const campus = new Map(campuses.map((c) => [c.id, c.name]));
    const entity = new Map(entities.map((e) => [e.id, e.name]));
    const unit = new Map(units.map((u) => [u.id, u.name]));
    return {
      campus: (id: string | null) => (id ? campus.get(id) ?? "—" : "—"),
      entity: (id: string | null) => (id ? entity.get(id) ?? "—" : "—"),
      unit: (id: string | null) => (id ? unit.get(id) ?? "—" : "—"),
    };
  }, [campuses, entities, units]);

  // ── Locations ─────────────────────────────────────────────────────────
  const openCreateLocation = () => {
    setEditingLocation(null);
    setLocationForm({ ...EMPTY_LOCATION });
    setLocationOpen(true);
  };

  const openEditLocation = (location: HrLocation) => {
    setEditingLocation(location);
    setLocationForm({
      name: location.name,
      address: location.address ?? "",
      campus_id: location.campus_id ?? "",
      business_unit_id: location.business_unit_id ?? "",
      legal_entity_id: location.legal_entity_id ?? "",
      timezone: location.timezone || "Asia/Kolkata",
      is_active: location.is_active,
    });
    setLocationOpen(true);
  };

  const saveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast({ title: "A location name is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      name: locationForm.name.trim(),
      address: locationForm.address.trim() || null,
      campus_id: locationForm.campus_id || null,
      business_unit_id: locationForm.business_unit_id || null,
      legal_entity_id: locationForm.legal_entity_id || null,
      timezone: locationForm.timezone.trim() || "Asia/Kolkata",
      is_active: locationForm.is_active,
    };
    const result = editingLocation
      ? await (supabase as any).from("hr_locations").update(payload).eq("id", editingLocation.id)
      : await (supabase as any).from("hr_locations").insert(payload);
    setBusy(false);
    if (result.error) {
      toast({ title: "Could not save the location", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingLocation ? "Location updated" : "Location added" });
    setLocationOpen(false);
    await fetchAll();
  };

  // ── Business units ────────────────────────────────────────────────────
  const openCreateUnit = () => {
    setEditingUnit(null);
    setUnitForm({ ...EMPTY_UNIT });
    setUnitOpen(true);
  };

  const openEditUnit = (unit: BusinessUnit) => {
    setEditingUnit(unit);
    setUnitForm({
      name: unit.name,
      code: unit.code ?? "",
      legal_entity_id: unit.legal_entity_id ?? "",
      is_active: unit.is_active,
    });
    setUnitOpen(true);
  };

  const saveUnit = async () => {
    if (!unitForm.name.trim()) {
      toast({ title: "A business unit name is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      name: unitForm.name.trim(),
      code: unitForm.code.trim() || null,
      legal_entity_id: unitForm.legal_entity_id || null,
      is_active: unitForm.is_active,
    };
    const result = editingUnit
      ? await (supabase as any).from("business_units").update(payload).eq("id", editingUnit.id)
      : await (supabase as any).from("business_units").insert(payload);
    setBusy(false);
    if (result.error) {
      toast({ title: "Could not save the business unit", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingUnit ? "Business unit updated" : "Business unit added" });
    setUnitOpen(false);
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Locations</h2>
            <Badge variant="outline" className="text-[11px]">{locations.length}</Badge>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openCreateLocation}>
              <Plus className="h-4 w-4 mr-1.5" /> Add location
            </Button>
          )}
        </div>

        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Campus</th>
                <th className="px-3 py-2 font-medium">Business unit</th>
                <th className="px-3 py-2 font-medium">Legal entity</th>
                <th className="px-3 py-2 font-medium">Timezone</th>
                <th className="px-3 py-2 font-medium">Active</th>
                {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-muted-foreground">No locations yet.</td>
                </tr>
              ) : locations.map((location) => (
                <tr key={location.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{location.name}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate" title={location.address ?? ""}>{location.address || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{refName.campus(location.campus_id)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{refName.unit(location.business_unit_id)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{refName.entity(location.legal_entity_id)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{location.timezone}</td>
                  <td className="px-3 py-2">{location.is_active
                    ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                    : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEditLocation(location)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Business units</h2>
            <Badge variant="outline" className="text-[11px]">{units.length}</Badge>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openCreateUnit}>
              <Plus className="h-4 w-4 mr-1.5" /> Add business unit
            </Button>
          )}
        </div>

        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[620px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Legal entity</th>
                <th className="px-3 py-2 font-medium">Active</th>
                {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {units.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} className="px-3 py-10 text-center text-muted-foreground">No business units yet.</td>
                </tr>
              ) : units.map((unit) => (
                <tr key={unit.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{unit.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{unit.code || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{refName.entity(unit.legal_entity_id)}</td>
                  <td className="px-3 py-2">{unit.is_active
                    ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                    : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEditUnit(unit)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Location dialog */}
      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              Name
              <Input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                className="mt-1 h-9 text-sm" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Address
              <Input value={locationForm.address} onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                placeholder="Optional" className="mt-1 h-9 text-sm" />
            </label>
            <SelectField
              label="Campus"
              value={locationForm.campus_id}
              onValueChange={(value) => setLocationForm({ ...locationForm, campus_id: value })}
              options={campuses.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="No campus"
            />
            <SelectField
              label="Business unit"
              value={locationForm.business_unit_id}
              onValueChange={(value) => setLocationForm({ ...locationForm, business_unit_id: value })}
              options={units.map((u) => ({ value: u.id, label: u.name }))}
              placeholder="No business unit"
            />
            <SelectField
              label="Legal entity"
              value={locationForm.legal_entity_id}
              onValueChange={(value) => setLocationForm({ ...locationForm, legal_entity_id: value })}
              options={entities.map((e) => ({ value: e.id, label: e.name }))}
              placeholder="No legal entity"
            />
            <label className="block text-xs text-muted-foreground">
              Timezone
              <Input value={locationForm.timezone}
                onChange={(e) => setLocationForm({ ...locationForm, timezone: e.target.value })}
                className="mt-1 h-9 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={locationForm.is_active}
                onChange={(e) => setLocationForm({ ...locationForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={saveLocation} disabled={busy}>{editingLocation ? "Save changes" : "Add location"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Business unit dialog */}
      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUnit ? "Edit business unit" : "Add business unit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              Name
              <Input value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                className="mt-1 h-9 text-sm" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Code
              <Input value={unitForm.code} onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                placeholder="Optional" className="mt-1 h-9 text-sm" />
            </label>
            <SelectField
              label="Legal entity"
              value={unitForm.legal_entity_id}
              onValueChange={(value) => setUnitForm({ ...unitForm, legal_entity_id: value })}
              options={entities.map((e) => ({ value: e.id, label: e.name }))}
              placeholder="No legal entity"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={unitForm.is_active}
                onChange={(e) => setUnitForm({ ...unitForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={saveUnit} disabled={busy}>{editingUnit ? "Save changes" : "Add business unit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LocationsPanel;
