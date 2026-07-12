import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export interface ChildStudent {
  id: string;
  name: string;
  admissionNo: string | null;
  campusName: string | null;
  batchId: string | null;
  batchName: string | null;
  courseName: string | null;
}

interface ChildContextType {
  children_: ChildStudent[];
  activeChild: ChildStudent | null;
  setActiveChildId: (id: string) => void;
  isLoading: boolean;
}

const ChildContext = createContext<ChildContextType | null>(null);

interface StudentRow {
  id: string;
  name: string;
  admission_no: string | null;
  batch_id: string | null;
  campuses: { name: string } | null;
  batches: { name: string } | null;
  courses: { name: string } | null;
}

/** Same query the web ParentPortal uses: own student row or any parent-linked rows. */
async function fetchChildren(userId: string): Promise<ChildStudent[]> {
  const { data, error } = await supabase
    .from('students')
    .select(
      'id, name, admission_no, batch_id, campuses:campus_id(name), batches:batch_id(name), courses:course_id(name)',
    )
    .or(
      `user_id.eq.${userId},father_user_id.eq.${userId},mother_user_id.eq.${userId},guardian_user_id.eq.${userId}`,
    );
  if (error) throw error;
  return ((data ?? []) as unknown as StudentRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    admissionNo: row.admission_no,
    batchId: row.batch_id,
    campusName: row.campuses?.name ?? null,
    batchName: row.batches?.name ?? null,
    courseName: row.courses?.name ?? null,
  }));
}

export function ChildProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['family-children', user?.id],
    queryFn: () => fetchChildren(user!.id),
    enabled: !!user,
  });

  const value = useMemo<ChildContextType>(() => {
    const list = data ?? [];
    const active = list.find((c) => c.id === selectedId) ?? list[0] ?? null;
    return {
      children_: list,
      activeChild: active,
      setActiveChildId: setSelectedId,
      isLoading,
    };
  }, [data, selectedId, isLoading]);

  return <ChildContext.Provider value={value}>{children}</ChildContext.Provider>;
}

export function useActiveChild(): ChildContextType {
  const ctx = useContext(ChildContext);
  if (!ctx) throw new Error('useActiveChild must be used within ChildProvider');
  return ctx;
}
