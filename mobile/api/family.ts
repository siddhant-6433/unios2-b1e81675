import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const ATTENDANCE_WINDOW_DAYS = 90;

export interface AttendanceSummary {
  totalDays: number;
  presentDays: number;
  ratio: number;
  recent: Array<{ date: string; status: string; subject: string | null }>;
}

export function useChildAttendance(studentId: string | undefined) {
  return useQuery({
    queryKey: ['attendance', studentId],
    enabled: !!studentId,
    queryFn: async (): Promise<AttendanceSummary> => {
      const since = new Date();
      since.setDate(since.getDate() - ATTENDANCE_WINDOW_DAYS);
      const { data, error } = await supabase
        .from('daily_attendance')
        .select('date, status, subject')
        .eq('student_id', studentId!)
        .gte('date', since.toISOString().slice(0, 10))
        .order('date', { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const presentDays = rows.filter((row) => row.status === 'present').length;
      return {
        totalDays: rows.length,
        presentDays,
        ratio: rows.length > 0 ? presentDays / rows.length : 0,
        recent: rows.slice(0, 30),
      };
    },
  });
}

export interface FeeSummary {
  totalBalance: number;
  nextDueDate: string | null;
  overdueCount: number;
  items: Array<{
    id: string;
    term: string | null;
    totalAmount: number;
    paidAmount: number;
    balance: number;
    status: string;
    dueDate: string | null;
    feeName: string | null;
  }>;
}

export function useChildFees(studentId: string | undefined) {
  return useQuery({
    queryKey: ['fees', studentId],
    enabled: !!studentId,
    queryFn: async (): Promise<FeeSummary> => {
      const { data, error } = await supabase
        .from('fee_ledger')
        .select('id, term, total_amount, paid_amount, balance, status, due_date, fee_codes:fee_code_id(name)')
        .eq('student_id', studentId!)
        .order('due_date', { ascending: true });
      if (error) throw error;
      const items = (data ?? []).map((row) => ({
        id: row.id as string,
        term: (row.term as string | null) ?? null,
        totalAmount: Number(row.total_amount ?? 0),
        paidAmount: Number(row.paid_amount ?? 0),
        balance: Number(row.balance ?? 0),
        status: (row.status as string) ?? 'due',
        dueDate: (row.due_date as string | null) ?? null,
        feeName: (row.fee_codes as { name: string } | null)?.name ?? null,
      }));
      const open = items.filter((item) => item.balance > 0);
      return {
        totalBalance: open.reduce((sum, item) => sum + item.balance, 0),
        nextDueDate: open.find((item) => item.dueDate)?.dueDate ?? null,
        overdueCount: items.filter((item) => item.status === 'overdue').length,
        items,
      };
    },
  });
}

export interface NoticeItem {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  validFrom: string;
  isRead: boolean;
}

/** Live notices visible to this user (existing RLS scopes by role/course/batch). */
export function useNotices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notices', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<NoticeItem[]> => {
      const [noticesRes, readsRes] = await Promise.all([
        supabase
          .from('notices')
          .select('id, title, body, category, pinned, valid_from')
          .order('pinned', { ascending: false })
          .order('valid_from', { ascending: false })
          .limit(50),
        supabase.from('notice_reads').select('notice_id').eq('user_id', user!.id),
      ]);
      if (noticesRes.error) throw noticesRes.error;
      const readIds = new Set((readsRes.data ?? []).map((row) => row.notice_id));
      return (noticesRes.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        category: row.category,
        pinned: row.pinned,
        validFrom: row.valid_from,
        isRead: readIds.has(row.id),
      }));
    },
  });
}

export function useMarkNoticeRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noticeId: string) => {
      const { error } = await supabase
        .from('notice_reads')
        .upsert({ notice_id: noticeId, user_id: user!.id });
      if (error) throw error;
    },
    // Optimistic: flip isRead immediately, roll back on failure.
    onMutate: async (noticeId: string) => {
      await queryClient.cancelQueries({ queryKey: ['notices', user?.id] });
      const previous = queryClient.getQueryData<NoticeItem[]>(['notices', user?.id]);
      queryClient.setQueryData<NoticeItem[]>(['notices', user?.id], (old) =>
        (old ?? []).map((n) => (n.id === noticeId ? { ...n, isRead: true } : n)),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['notices', user?.id], ctx.previous);
    },
  });
}
