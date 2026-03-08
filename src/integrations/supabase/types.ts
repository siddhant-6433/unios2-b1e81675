export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admission_sessions: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
        }
        Relationships: []
      }
      batches: {
        Row: {
          course_id: string
          created_at: string
          id: string
          max_strength: number | null
          name: string
          section: string | null
          session_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          max_strength?: number | null
          name: string
          section?: string | null
          session_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          max_strength?: number | null
          name?: string
          section?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "admission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      campuses: {
        Row: {
          address: string | null
          city: string | null
          code: string
          created_at: string
          id: string
          name: string
          state: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          state?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          state?: string | null
        }
        Relationships: []
      }
      concessions: {
        Row: {
          approved_by: string | null
          created_at: string
          fee_ledger_id: string | null
          id: string
          reason: string | null
          requested_by: string | null
          status: string
          student_id: string
          type: string
          value: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          reason?: string | null
          requested_by?: string | null
          status?: string
          student_id: string
          type: string
          value: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          reason?: string | null
          requested_by?: string | null
          status?: string
          student_id?: string
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_fee_ledger_id_fkey"
            columns: ["fee_ledger_id"]
            isOneToOne: false
            referencedRelation: "fee_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string
          created_at: string
          department_id: string
          duration_years: number
          id: string
          name: string
          type: string
        }
        Insert: {
          code: string
          created_at?: string
          department_id: string
          duration_years?: number
          id?: string
          name: string
          type?: string
        }
        Update: {
          code?: string
          created_at?: string
          department_id?: string
          duration_years?: number
          id?: string
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          id: string
          institution_id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          institution_id: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          institution_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_codes: {
        Row: {
          category: string
          code: string
          created_at: string
          id: string
          is_recurring: boolean
          name: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          id?: string
          is_recurring?: boolean
          name: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          id?: string
          is_recurring?: boolean
          name?: string
        }
        Relationships: []
      }
      fee_ledger: {
        Row: {
          balance: number | null
          concession: number
          created_at: string
          due_date: string
          fee_code_id: string
          id: string
          paid_amount: number
          status: string
          student_id: string
          term: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          balance?: number | null
          concession?: number
          created_at?: string
          due_date: string
          fee_code_id: string
          id?: string
          paid_amount?: number
          status?: string
          student_id: string
          term: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          balance?: number | null
          concession?: number
          created_at?: string
          due_date?: string
          fee_code_id?: string
          id?: string
          paid_amount?: number
          status?: string
          student_id?: string
          term?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_ledger_fee_code_id_fkey"
            columns: ["fee_code_id"]
            isOneToOne: false
            referencedRelation: "fee_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_ledger_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structure_items: {
        Row: {
          amount: number
          created_at: string
          due_day: number
          fee_code_id: string
          fee_structure_id: string
          id: string
          term: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_day?: number
          fee_code_id: string
          fee_structure_id: string
          id?: string
          term: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_day?: number
          fee_code_id?: string
          fee_structure_id?: string
          id?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structure_items_fee_code_id_fkey"
            columns: ["fee_code_id"]
            isOneToOne: false
            referencedRelation: "fee_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structure_items_fee_structure_id_fkey"
            columns: ["fee_structure_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          course_id: string
          created_at: string
          id: string
          is_active: boolean
          session_id: string
          version: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          session_id: string
          version: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          session_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "admission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          campus_id: string
          code: string
          created_at: string
          id: string
          name: string
          type: string
        }
        Insert: {
          campus_id: string
          code: string
          created_at?: string
          id?: string
          name: string
          type: string
        }
        Update: {
          campus_id?: string
          code?: string
          created_at?: string
          id?: string
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "institutions_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          created_at: string
          description: string
          id: string
          lead_id: string
          new_stage: Database["public"]["Enums"]["lead_stage"] | null
          old_stage: Database["public"]["Enums"]["lead_stage"] | null
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          lead_id: string
          new_stage?: Database["public"]["Enums"]["lead_stage"] | null
          old_stage?: Database["public"]["Enums"]["lead_stage"] | null
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          lead_id?: string
          new_stage?: Database["public"]["Enums"]["lead_stage"] | null
          old_stage?: Database["public"]["Enums"]["lead_stage"] | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          admission_no: string | null
          application_id: string | null
          campus_id: string | null
          counsellor_id: string | null
          course_id: string | null
          created_at: string
          email: string | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          interview_result: string | null
          interview_score: number | null
          name: string
          notes: string | null
          offer_amount: number | null
          phone: string
          pre_admission_no: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["lead_stage"]
          token_amount: number | null
          updated_at: string
          visit_date: string | null
        }
        Insert: {
          admission_no?: string | null
          application_id?: string | null
          campus_id?: string | null
          counsellor_id?: string | null
          course_id?: string | null
          created_at?: string
          email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          interview_result?: string | null
          interview_score?: number | null
          name: string
          notes?: string | null
          offer_amount?: number | null
          phone: string
          pre_admission_no?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          token_amount?: number | null
          updated_at?: string
          visit_date?: string | null
        }
        Update: {
          admission_no?: string | null
          application_id?: string | null
          campus_id?: string | null
          counsellor_id?: string | null
          course_id?: string | null
          created_at?: string
          email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          interview_result?: string | null
          interview_score?: number | null
          name?: string
          notes?: string | null
          offer_amount?: number | null
          phone?: string
          pre_admission_no?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          token_amount?: number | null
          updated_at?: string
          visit_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          fee_ledger_id: string | null
          id: string
          notes: string | null
          paid_at: string
          payment_mode: string
          receipt_no: string | null
          recorded_by: string | null
          student_id: string
          transaction_ref: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          payment_mode: string
          receipt_no?: string | null
          recorded_by?: string | null
          student_id: string
          transaction_ref?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          payment_mode?: string
          receipt_no?: string | null
          recorded_by?: string | null
          student_id?: string
          transaction_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_fee_ledger_id_fkey"
            columns: ["fee_ledger_id"]
            isOneToOne: false
            referencedRelation: "fee_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          campus: string | null
          created_at: string
          department: string | null
          display_name: string | null
          id: string
          institution: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          campus?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          id?: string
          institution?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          campus?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          id?: string
          institution?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          address: string | null
          admission_date: string | null
          admission_no: string | null
          batch_id: string | null
          blood_group: string | null
          campus_id: string | null
          course_id: string | null
          created_at: string
          dob: string | null
          email: string | null
          fee_structure_version: string | null
          gender: string | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          lead_id: string | null
          name: string
          phone: string | null
          photo_url: string | null
          pre_admission_no: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["student_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          admission_date?: string | null
          admission_no?: string | null
          batch_id?: string | null
          blood_group?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          fee_structure_version?: string | null
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          lead_id?: string | null
          name: string
          phone?: string | null
          photo_url?: string | null
          pre_admission_no?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          admission_date?: string | null
          admission_no?: string | null
          batch_id?: string | null
          blood_group?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          fee_structure_version?: string | null
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          phone?: string | null
          photo_url?: string | null
          pre_admission_no?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "admission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_otps: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          otp_hash: string
          phone: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          otp_hash: string
          phone: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          phone?: string
          verified?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "campus_admin"
        | "principal"
        | "admission_head"
        | "counsellor"
        | "accountant"
        | "faculty"
        | "teacher"
        | "data_entry"
        | "office_assistant"
        | "hostel_warden"
        | "student"
        | "parent"
      lead_source:
        | "website"
        | "meta_ads"
        | "google_ads"
        | "shiksha"
        | "walk_in"
        | "consultant"
        | "justdial"
        | "referral"
        | "education_fair"
        | "other"
      lead_stage:
        | "new_lead"
        | "ai_called"
        | "counsellor_call"
        | "visit_scheduled"
        | "interview"
        | "offer_sent"
        | "token_paid"
        | "pre_admitted"
        | "admitted"
        | "rejected"
      student_status:
        | "pre_admitted"
        | "active"
        | "inactive"
        | "alumni"
        | "dropped"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "campus_admin",
        "principal",
        "admission_head",
        "counsellor",
        "accountant",
        "faculty",
        "teacher",
        "data_entry",
        "office_assistant",
        "hostel_warden",
        "student",
        "parent",
      ],
      lead_source: [
        "website",
        "meta_ads",
        "google_ads",
        "shiksha",
        "walk_in",
        "consultant",
        "justdial",
        "referral",
        "education_fair",
        "other",
      ],
      lead_stage: [
        "new_lead",
        "ai_called",
        "counsellor_call",
        "visit_scheduled",
        "interview",
        "offer_sent",
        "token_paid",
        "pre_admitted",
        "admitted",
        "rejected",
      ],
      student_status: [
        "pre_admitted",
        "active",
        "inactive",
        "alumni",
        "dropped",
      ],
    },
  },
} as const
