Initialising login role...
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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      applications: {
        Row: {
          aadhaar: string | null
          academic_details: Json | null
          address: Json | null
          apaar_id: string | null
          application_id: string
          category: string | null
          completed_sections: Json | null
          course_selections: Json
          created_at: string
          dob: string | null
          email: string | null
          extracurricular: Json | null
          father: Json | null
          fee_amount: number | null
          flags: string[] | null
          full_name: string
          gender: string | null
          guardian: Json | null
          id: string
          institution_id: string | null
          lead_id: string | null
          mother: Json | null
          nationality: string | null
          payment_ref: string | null
          payment_status: string | null
          pen_number: string | null
          phone: string
          program_category: string | null
          result_status: Json | null
          school_details: Json | null
          session_id: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          whatsapp_verified: boolean | null
        }
        Insert: {
          aadhaar?: string | null
          academic_details?: Json | null
          address?: Json | null
          apaar_id?: string | null
          application_id: string
          category?: string | null
          completed_sections?: Json | null
          course_selections?: Json
          created_at?: string
          dob?: string | null
          email?: string | null
          extracurricular?: Json | null
          father?: Json | null
          fee_amount?: number | null
          flags?: string[] | null
          full_name?: string
          gender?: string | null
          guardian?: Json | null
          id?: string
          institution_id?: string | null
          lead_id?: string | null
          mother?: Json | null
          nationality?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          pen_number?: string | null
          phone?: string
          program_category?: string | null
          result_status?: Json | null
          school_details?: Json | null
          session_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          whatsapp_verified?: boolean | null
        }
        Update: {
          aadhaar?: string | null
          academic_details?: Json | null
          address?: Json | null
          apaar_id?: string | null
          application_id?: string
          category?: string | null
          completed_sections?: Json | null
          course_selections?: Json
          created_at?: string
          dob?: string | null
          email?: string | null
          extracurricular?: Json | null
          father?: Json | null
          fee_amount?: number | null
          flags?: string[] | null
          full_name?: string
          gender?: string | null
          guardian?: Json | null
          id?: string
          institution_id?: string | null
          lead_id?: string | null
          mother?: Json | null
          nationality?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          pen_number?: string | null
          phone?: string
          program_category?: string | null
          result_status?: Json | null
          school_details?: Json | null
          session_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          whatsapp_verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "admission_sessions"
            referencedColumns: ["id"]
          },
        ]
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
      call_logs: {
        Row: {
          called_at: string
          created_at: string
          direction: string
          disposition: string | null
          duration_seconds: number | null
          id: string
          lead_id: string
          notes: string | null
          recording_url: string | null
          user_id: string | null
        }
        Insert: {
          called_at?: string
          created_at?: string
          direction?: string
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id: string
          notes?: string | null
          recording_url?: string | null
          user_id?: string | null
        }
        Update: {
          called_at?: string
          created_at?: string
          direction?: string
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id?: string
          notes?: string | null
          recording_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campus_visits: {
        Row: {
          campus_id: string | null
          created_at: string
          feedback: string | null
          id: string
          lead_id: string
          scheduled_by: string | null
          status: string
          updated_at: string
          visit_date: string
        }
        Insert: {
          campus_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          lead_id: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
          visit_date: string
        }
        Update: {
          campus_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          lead_id?: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
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
      consultants: {
        Row: {
          city: string | null
          commission_type: string | null
          commission_value: number | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          relationship_manager_id: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          commission_type?: string | null
          commission_value?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          relationship_manager_id?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          commission_type?: string | null
          commission_value?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          relationship_manager_id?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: []
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
      daily_attendance: {
        Row: {
          batch_id: string | null
          created_at: string
          date: string
          id: string
          marked_by: string | null
          status: string
          student_id: string
          subject: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          date: string
          id?: string
          marked_by?: string | null
          status?: string
          student_id: string
          subject?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          status?: string
          student_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_attendance_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
      eligibility_rules: {
        Row: {
          class_12_min_marks: number | null
          course_id: string
          created_at: string
          entrance_exam_name: string | null
          entrance_exam_required: boolean | null
          graduation_min_marks: number | null
          id: string
          max_age: number | null
          min_age: number | null
          notes: string | null
          requires_graduation: boolean | null
          subject_min_marks: Json | null
          subject_prerequisites: string[] | null
          updated_at: string
        }
        Insert: {
          class_12_min_marks?: number | null
          course_id: string
          created_at?: string
          entrance_exam_name?: string | null
          entrance_exam_required?: boolean | null
          graduation_min_marks?: number | null
          id?: string
          max_age?: number | null
          min_age?: number | null
          notes?: string | null
          requires_graduation?: boolean | null
          subject_min_marks?: Json | null
          subject_prerequisites?: string[] | null
          updated_at?: string
        }
        Update: {
          class_12_min_marks?: number | null
          course_id?: string
          created_at?: string
          entrance_exam_name?: string | null
          entrance_exam_required?: boolean | null
          graduation_min_marks?: number | null
          id?: string
          max_age?: number | null
          min_age?: number | null
          notes?: string | null
          requires_graduation?: boolean | null
          subject_min_marks?: Json | null
          subject_prerequisites?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_rules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_profiles: {
        Row: {
          aadhaar_number: string | null
          blood_group: string | null
          campus_id: string | null
          created_at: string
          current_address: Json | null
          date_of_birth: string | null
          date_of_joining: string | null
          department_id: string | null
          display_name: string | null
          dotted_line_manager: string | null
          education: Json | null
          employee_number: string | null
          employment_status: string | null
          experience: Json | null
          first_name: string | null
          gender: string | null
          id: string
          institution_id: string | null
          job_title: string | null
          job_title_secondary: string | null
          last_name: string | null
          marital_status: string | null
          middle_name: string | null
          mobile_number: string | null
          nationality: string | null
          notice_period_days: number | null
          pan_number: string | null
          permanent_address: Json | null
          personal_email: string | null
          photo_url: string | null
          physically_handicapped: boolean | null
          professional_summary: string | null
          reports_to: string | null
          residence_number: string | null
          time_type: string | null
          updated_at: string
          user_id: string
          work_email: string | null
          work_number: string | null
          worker_type: string | null
        }
        Insert: {
          aadhaar_number?: string | null
          blood_group?: string | null
          campus_id?: string | null
          created_at?: string
          current_address?: Json | null
          date_of_birth?: string | null
          date_of_joining?: string | null
          department_id?: string | null
          display_name?: string | null
          dotted_line_manager?: string | null
          education?: Json | null
          employee_number?: string | null
          employment_status?: string | null
          experience?: Json | null
          first_name?: string | null
          gender?: string | null
          id?: string
          institution_id?: string | null
          job_title?: string | null
          job_title_secondary?: string | null
          last_name?: string | null
          marital_status?: string | null
          middle_name?: string | null
          mobile_number?: string | null
          nationality?: string | null
          notice_period_days?: number | null
          pan_number?: string | null
          permanent_address?: Json | null
          personal_email?: string | null
          photo_url?: string | null
          physically_handicapped?: boolean | null
          professional_summary?: string | null
          reports_to?: string | null
          residence_number?: string | null
          time_type?: string | null
          updated_at?: string
          user_id: string
          work_email?: string | null
          work_number?: string | null
          worker_type?: string | null
        }
        Update: {
          aadhaar_number?: string | null
          blood_group?: string | null
          campus_id?: string | null
          created_at?: string
          current_address?: Json | null
          date_of_birth?: string | null
          date_of_joining?: string | null
          department_id?: string | null
          display_name?: string | null
          dotted_line_manager?: string | null
          education?: Json | null
          employee_number?: string | null
          employment_status?: string | null
          experience?: Json | null
          first_name?: string | null
          gender?: string | null
          id?: string
          institution_id?: string | null
          job_title?: string | null
          job_title_secondary?: string | null
          last_name?: string | null
          marital_status?: string | null
          middle_name?: string | null
          mobile_number?: string | null
          nationality?: string | null
          notice_period_days?: number | null
          pan_number?: string | null
          permanent_address?: Json | null
          personal_email?: string | null
          photo_url?: string | null
          physically_handicapped?: boolean | null
          professional_summary?: string | null
          reports_to?: string | null
          residence_number?: string | null
          time_type?: string | null
          updated_at?: string
          user_id?: string
          work_email?: string | null
          work_number?: string | null
          worker_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_records: {
        Row: {
          batch_id: string | null
          created_at: string
          exam_date: string | null
          exam_type: string
          grade: string | null
          id: string
          max_marks: number
          obtained_marks: number
          student_id: string
          subject: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          exam_date?: string | null
          exam_type?: string
          grade?: string | null
          id?: string
          max_marks: number
          obtained_marks?: number
          student_id: string
          subject: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          exam_date?: string | null
          exam_type?: string
          grade?: string | null
          id?: string
          max_marks?: number
          obtained_marks?: number
          student_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_records_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          metadata: Json | null
          session_id: string
          version: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          session_id: string
          version: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
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
      institution_group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          institution_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          institution_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          institution_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "institution_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "institution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "institution_group_members_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_groups: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
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
      lead_allocation_rules: {
        Row: {
          assigned_to: string | null
          assignment_type: string
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          priority: number
          round_robin_pool: string[] | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          assignment_type?: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          round_robin_pool?: string[] | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          assignment_type?: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          round_robin_pool?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      lead_counsellors: {
        Row: {
          added_by: string | null
          counsellor_id: string
          created_at: string
          id: string
          lead_id: string
          role: string
        }
        Insert: {
          added_by?: string | null
          counsellor_id: string
          created_at?: string
          id?: string
          lead_id: string
          role?: string
        }
        Update: {
          added_by?: string | null
          counsellor_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_counsellors_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_followups: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          scheduled_at: string
          status: string
          type: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          scheduled_at: string
          status?: string
          type?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          scheduled_at?: string
          status?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          lead_id: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          lead_id: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          admission_no: string | null
          application_id: string | null
          application_progress: Json | null
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
          person_role: string
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
          application_progress?: Json | null
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
          person_role?: string
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
          application_progress?: Json | null
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
          person_role?: string
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
      offer_letters: {
        Row: {
          acceptance_deadline: string | null
          accepted_at: string | null
          campus_id: string | null
          course_id: string | null
          created_at: string
          id: string
          issued_by: string | null
          lead_id: string
          net_fee: number
          scholarship_amount: number | null
          status: string
          total_fee: number
        }
        Insert: {
          acceptance_deadline?: string | null
          accepted_at?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          issued_by?: string | null
          lead_id: string
          net_fee: number
          scholarship_amount?: number | null
          status?: string
          total_fee: number
        }
        Update: {
          acceptance_deadline?: string | null
          accepted_at?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          issued_by?: string | null
          lead_id?: string
          net_fee?: number
          scholarship_amount?: number | null
          status?: string
          total_fee?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_letters_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_gateway_config: {
        Row: {
          display_name: string
          gateway: string
          is_enabled_fee_collection: boolean
          is_enabled_portal_payment: boolean
          updated_at: string
        }
        Insert: {
          display_name: string
          gateway: string
          is_enabled_fee_collection?: boolean
          is_enabled_portal_payment?: boolean
          updated_at?: string
        }
        Update: {
          display_name?: string
          gateway?: string
          is_enabled_fee_collection?: boolean
          is_enabled_portal_payment?: boolean
          updated_at?: string
        }
        Relationships: []
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
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          leader_id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          leader_id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          leader_id?: string
          name?: string
        }
        Relationships: []
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
      can_view_lead: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
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
        | "application_in_progress"
        | "application_submitted"
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
  graphql_public: {
    Enums: {},
  },
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
        "application_in_progress",
        "application_submitted",
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
