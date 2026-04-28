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
      _app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
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
      ai_call_logs: {
        Row: {
          ai_transcript: string | null
          bill_cost: number | null
          bill_duration: number | null
          call_uuid: string | null
          caller_transcript: string | null
          created_at: string
          direction: string
          disposition: string | null
          disposition_notes: string | null
          duration_seconds: number | null
          followup_scheduled: boolean | null
          from_number: string | null
          hangup_cause: string | null
          id: string
          initiated_by: string | null
          lead_id: string | null
          recording_duration: number | null
          recording_url: string | null
          status: string | null
          to_number: string | null
          tool_calls_made: Json | null
          visit_scheduled: boolean | null
        }
        Insert: {
          ai_transcript?: string | null
          bill_cost?: number | null
          bill_duration?: number | null
          call_uuid?: string | null
          caller_transcript?: string | null
          created_at?: string
          direction?: string
          disposition?: string | null
          disposition_notes?: string | null
          duration_seconds?: number | null
          followup_scheduled?: boolean | null
          from_number?: string | null
          hangup_cause?: string | null
          id?: string
          initiated_by?: string | null
          lead_id?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          status?: string | null
          to_number?: string | null
          tool_calls_made?: Json | null
          visit_scheduled?: boolean | null
        }
        Update: {
          ai_transcript?: string | null
          bill_cost?: number | null
          bill_duration?: number | null
          call_uuid?: string | null
          caller_transcript?: string | null
          created_at?: string
          direction?: string
          disposition?: string | null
          disposition_notes?: string | null
          duration_seconds?: number | null
          followup_scheduled?: boolean | null
          from_number?: string | null
          hangup_cause?: string | null
          id?: string
          initiated_by?: string | null
          lead_id?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          status?: string | null
          to_number?: string | null
          tool_calls_made?: Json | null
          visit_scheduled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_call_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_id: string
          requested_by: string | null
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id: string
          requested_by?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          requested_by?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_call_records: {
        Row: {
          call_uuid: string | null
          completed_at: string | null
          conversion_probability: number | null
          created_at: string
          disposition: string | null
          duration_seconds: number | null
          id: string
          initiated_by: string | null
          lead_id: string
          plivo_call_uuid: string | null
          recording_url: string | null
          status: string
          summary: string | null
          transcript: string | null
        }
        Insert: {
          call_uuid?: string | null
          completed_at?: string | null
          conversion_probability?: number | null
          created_at?: string
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          initiated_by?: string | null
          lead_id: string
          plivo_call_uuid?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
        }
        Update: {
          call_uuid?: string | null
          completed_at?: string | null
          conversion_probability?: number | null
          created_at?: string
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          initiated_by?: string | null
          lead_id?: string
          plivo_call_uuid?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      alumni_verification_requests: {
        Row: {
          additional_doc_urls: string[] | null
          admin_approval_notes: string | null
          admin_approved_at: string | null
          admin_approved_by: string | null
          alumni_name: string
          batch_number: string | null
          campus: string | null
          contact_email: string | null
          contact_name: string
          contact_phone_spoc: string
          copy_type: string | null
          course: string
          created_at: string
          diploma_certificate_url: string | null
          due_date: string | null
          employee_draft_email: string | null
          employee_review_doc_url: string | null
          employee_review_notes: string | null
          employee_review_result: string | null
          employee_reviewed_at: string | null
          employee_reviewed_by: string | null
          employer_name: string
          enrollment_no: string | null
          fee_amount: number
          id: string
          marksheet_urls: string[] | null
          paid_at: string | null
          payment_method: string | null
          payment_ref: string | null
          request_number: string | null
          request_type: string | null
          requestor_phone: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sent_email_body: string | null
          sent_email_subject: string | null
          status: string
          third_party_company: string | null
          updated_at: string
          verification_result: string | null
          year_of_passing: number
        }
        Insert: {
          additional_doc_urls?: string[] | null
          admin_approval_notes?: string | null
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          alumni_name: string
          batch_number?: string | null
          campus?: string | null
          contact_email?: string | null
          contact_name: string
          contact_phone_spoc: string
          copy_type?: string | null
          course: string
          created_at?: string
          diploma_certificate_url?: string | null
          due_date?: string | null
          employee_draft_email?: string | null
          employee_review_doc_url?: string | null
          employee_review_notes?: string | null
          employee_review_result?: string | null
          employee_reviewed_at?: string | null
          employee_reviewed_by?: string | null
          employer_name: string
          enrollment_no?: string | null
          fee_amount?: number
          id?: string
          marksheet_urls?: string[] | null
          paid_at?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          request_number?: string | null
          request_type?: string | null
          requestor_phone: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sent_email_body?: string | null
          sent_email_subject?: string | null
          status?: string
          third_party_company?: string | null
          updated_at?: string
          verification_result?: string | null
          year_of_passing: number
        }
        Update: {
          additional_doc_urls?: string[] | null
          admin_approval_notes?: string | null
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          alumni_name?: string
          batch_number?: string | null
          campus?: string | null
          contact_email?: string | null
          contact_name?: string
          contact_phone_spoc?: string
          copy_type?: string | null
          course?: string
          created_at?: string
          diploma_certificate_url?: string | null
          due_date?: string | null
          employee_draft_email?: string | null
          employee_review_doc_url?: string | null
          employee_review_notes?: string | null
          employee_review_result?: string | null
          employee_reviewed_at?: string | null
          employee_reviewed_by?: string | null
          employer_name?: string
          enrollment_no?: string | null
          fee_amount?: number
          id?: string
          marksheet_urls?: string[] | null
          paid_at?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          request_number?: string | null
          request_type?: string | null
          requestor_phone?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sent_email_body?: string | null
          sent_email_subject?: string | null
          status?: string
          third_party_company?: string | null
          updated_at?: string
          verification_result?: string | null
          year_of_passing?: number
        }
        Relationships: []
      }
      application_audit_log: {
        Row: {
          application_id: string
          changed_by: string | null
          changed_by_name: string | null
          changed_by_role: string | null
          created_at: string
          field_path: string
          id: string
          new_value: Json | null
          old_value: Json | null
          section: string
        }
        Insert: {
          application_id: string
          changed_by?: string | null
          changed_by_name?: string | null
          changed_by_role?: string | null
          created_at?: string
          field_path: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          section: string
        }
        Update: {
          application_id?: string
          changed_by?: string | null
          changed_by_name?: string | null
          changed_by_role?: string | null
          created_at?: string
          field_path?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_audit_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_edit_requests: {
        Row: {
          application_id: string
          created_at: string
          duration_hours: number
          expires_at: string | null
          id: string
          reason: string
          requested_by: string
          requested_by_name: string | null
          requested_by_role: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          reviewed_by_role: string | null
          sections: string[] | null
          status: string
        }
        Insert: {
          application_id: string
          created_at?: string
          duration_hours?: number
          expires_at?: string | null
          id?: string
          reason: string
          requested_by: string
          requested_by_name?: string | null
          requested_by_role?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          reviewed_by_role?: string | null
          sections?: string[] | null
          status?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          duration_hours?: number
          expires_at?: string | null
          id?: string
          reason?: string
          requested_by?: string
          requested_by_name?: string | null
          requested_by_role?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          reviewed_by_role?: string | null
          sections?: string[] | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_edit_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          aadhaar: string | null
          academic_details: Json | null
          address: Json | null
          apaar_id: string | null
          applicant_type: string | null
          application_id: string
          category: string | null
          completed_sections: Json | null
          course_selections: Json
          created_at: string
          dob: string | null
          edit_unlocked_sections: string[] | null
          edit_unlocked_until: string | null
          email: string | null
          extracurricular: Json | null
          father: Json | null
          fee_amount: number | null
          flags: string[] | null
          full_name: string
          gap_years: number | null
          gender: string | null
          guardian: Json | null
          id: string
          institution_id: string | null
          is_nri: boolean | null
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
          state_domicile: string | null
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
          applicant_type?: string | null
          application_id: string
          category?: string | null
          completed_sections?: Json | null
          course_selections?: Json
          created_at?: string
          dob?: string | null
          edit_unlocked_sections?: string[] | null
          edit_unlocked_until?: string | null
          email?: string | null
          extracurricular?: Json | null
          father?: Json | null
          fee_amount?: number | null
          flags?: string[] | null
          full_name?: string
          gap_years?: number | null
          gender?: string | null
          guardian?: Json | null
          id?: string
          institution_id?: string | null
          is_nri?: boolean | null
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
          state_domicile?: string | null
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
          applicant_type?: string | null
          application_id?: string
          category?: string | null
          completed_sections?: Json | null
          course_selections?: Json
          created_at?: string
          dob?: string | null
          edit_unlocked_sections?: string[] | null
          edit_unlocked_until?: string | null
          email?: string | null
          extracurricular?: Json | null
          father?: Json | null
          fee_amount?: number | null
          flags?: string[] | null
          full_name?: string
          gap_years?: number | null
          gender?: string | null
          guardian?: Json | null
          id?: string
          institution_id?: string | null
          is_nri?: boolean | null
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
          state_domicile?: string | null
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
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
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
      approval_bodies: {
        Row: {
          body_type: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          short_name: string | null
          slug: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          body_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          short_name?: string | null
          slug?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          body_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          short_name?: string | null
          slug?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      approval_letter_courses: {
        Row: {
          course_id: string
          id: string
          letter_id: string
        }
        Insert: {
          course_id: string
          id?: string
          letter_id: string
        }
        Update: {
          course_id?: string
          id?: string
          letter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_letter_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "approval_letter_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "approval_letter_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_letter_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "approval_letter_courses_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "approval_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_letters: {
        Row: {
          academic_session: string | null
          approval_body_id: string | null
          created_at: string | null
          file_upload_url: string | null
          file_url: string | null
          id: string
          institution_name: string | null
          is_active: boolean | null
          issue_date: string | null
          name: string
          slug: string | null
          updated_at: string | null
          webflow_item_id: string | null
        }
        Insert: {
          academic_session?: string | null
          approval_body_id?: string | null
          created_at?: string | null
          file_upload_url?: string | null
          file_url?: string | null
          id?: string
          institution_name?: string | null
          is_active?: boolean | null
          issue_date?: string | null
          name: string
          slug?: string | null
          updated_at?: string | null
          webflow_item_id?: string | null
        }
        Update: {
          academic_session?: string | null
          approval_body_id?: string | null
          created_at?: string | null
          file_upload_url?: string | null
          file_url?: string | null
          id?: string
          institution_name?: string | null
          is_active?: boolean | null
          issue_date?: string | null
          name?: string
          slug?: string | null
          updated_at?: string | null
          webflow_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_letters_approval_body_id_fkey"
            columns: ["approval_body_id"]
            isOneToOne: false
            referencedRelation: "approval_bodies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rule_executions: {
        Row: {
          actions_executed: Json
          created_at: string | null
          error_message: string | null
          id: string
          lead_id: string
          rule_id: string
          status: string | null
        }
        Insert: {
          actions_executed?: Json
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          rule_id: string
          status?: string | null
        }
        Update: {
          actions_executed?: Json
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          rule_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          actions: Json
          campus_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          trigger_config: Json
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          actions?: Json
          campus_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          actions?: Json
          campus_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "batches_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "batches_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
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
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
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
          visit_type: string | null
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
          visit_type?: string | null
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
          visit_type?: string | null
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
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      campuses: {
        Row: {
          address: string | null
          apply_url: string | null
          city: string | null
          code: string
          created_at: string
          geofence_radius_meters: number | null
          google_maps_url: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          state: string | null
        }
        Insert: {
          address?: string | null
          apply_url?: string | null
          city?: string | null
          code: string
          created_at?: string
          geofence_radius_meters?: number | null
          google_maps_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          state?: string | null
        }
        Update: {
          address?: string | null
          apply_url?: string | null
          city?: string | null
          code?: string
          created_at?: string
          geofence_radius_meters?: number | null
          google_maps_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          state?: string | null
        }
        Relationships: []
      }
      commission_edit_requests: {
        Row: {
          consultant_id: string
          course_id: string
          created_at: string
          current_amount: number | null
          id: string
          reason: string | null
          requested_amount: number
          requested_by: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          consultant_id: string
          course_id: string
          created_at?: string
          current_amount?: number | null
          id?: string
          reason?: string | null
          requested_amount: number
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          consultant_id?: string
          course_id?: string
          created_at?: string
          current_amount?: number | null
          id?: string
          reason?: string | null
          requested_amount?: number
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_edit_requests_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_dashboard"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_roi_summary"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_edit_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_edit_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "commission_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      concessions: {
        Row: {
          approved_by: string | null
          approved_by_principal: string | null
          approved_by_super_admin: string | null
          created_at: string
          fee_ledger_id: string | null
          id: string
          principal_decision_at: string | null
          reason: string | null
          requested_by: string | null
          status: string
          student_id: string
          super_admin_decision_at: string | null
          type: string
          value: number
        }
        Insert: {
          approved_by?: string | null
          approved_by_principal?: string | null
          approved_by_super_admin?: string | null
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          principal_decision_at?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          student_id: string
          super_admin_decision_at?: string | null
          type: string
          value: number
        }
        Update: {
          approved_by?: string | null
          approved_by_principal?: string | null
          approved_by_super_admin?: string | null
          created_at?: string
          fee_ledger_id?: string | null
          id?: string
          principal_decision_at?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          student_id?: string
          super_admin_decision_at?: string | null
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "concessions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "concessions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "concessions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
      consultant_commissions: {
        Row: {
          commission_type: string
          commission_value: number
          consultant_id: string
          course_id: string
          created_at: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          commission_type?: string
          commission_value?: number
          consultant_id: string
          course_id: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          commission_type?: string
          commission_value?: number
          consultant_id?: string
          course_id?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_commissions_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_dashboard"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_commissions_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_roi_summary"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_commissions_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_commissions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "consultant_commissions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "consultant_commissions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_commissions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      consultant_payouts: {
        Row: {
          annual_fee: number
          approved_by: string | null
          commission_type: string
          commission_value: number
          consultant_id: string
          course_id: string | null
          created_at: string | null
          fee_paid_pct: number
          id: string
          lead_id: string
          lead_payment_id: string | null
          notes: string | null
          paid_at: string | null
          payout_amount: number
          status: string | null
          student_fee_paid: number
        }
        Insert: {
          annual_fee: number
          approved_by?: string | null
          commission_type: string
          commission_value: number
          consultant_id: string
          course_id?: string | null
          created_at?: string | null
          fee_paid_pct: number
          id?: string
          lead_id: string
          lead_payment_id?: string | null
          notes?: string | null
          paid_at?: string | null
          payout_amount: number
          status?: string | null
          student_fee_paid: number
        }
        Update: {
          annual_fee?: number
          approved_by?: string | null
          commission_type?: string
          commission_value?: number
          consultant_id?: string
          course_id?: string | null
          created_at?: string | null
          fee_paid_pct?: number
          id?: string
          lead_id?: string
          lead_payment_id?: string | null
          notes?: string | null
          paid_at?: string | null
          payout_amount?: number
          status?: string | null
          student_fee_paid?: number
        }
        Relationships: [
          {
            foreignKeyName: "consultant_payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "consultant_payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "consultant_payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "consultant_payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "consultant_payouts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_dashboard"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_payouts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_roi_summary"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_payouts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "consultant_payouts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "consultant_payouts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payouts_lead_payment_id_fkey"
            columns: ["lead_payment_id"]
            isOneToOne: false
            referencedRelation: "lead_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_voice_messages: {
        Row: {
          audio_path: string
          audio_url: string
          consultant_id: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          read_at: string | null
          read_by: string | null
          sender_user_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          audio_path: string
          audio_url: string
          consultant_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          read_at?: string | null
          read_by?: string | null
          sender_user_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          audio_path?: string
          audio_url?: string
          consultant_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          read_at?: string | null
          read_by?: string | null
          sender_user_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_voice_messages_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_dashboard"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_voice_messages_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_roi_summary"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_voice_messages_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
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
          user_id: string | null
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
          user_id?: string | null
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
          user_id?: string | null
        }
        Relationships: []
      }
      counsellor_score_events: {
        Row: {
          action_type: string
          counsellor_id: string
          created_at: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          points: number
        }
        Insert: {
          action_type: string
          counsellor_id: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          points: number
        }
        Update: {
          action_type?: string
          counsellor_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "counsellor_score_events_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "counsellor_score_events_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "counsellor_score_events_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "counsellor_score_events_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_score_events_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_score_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      counsellor_targets: {
        Row: {
          calls_target: number | null
          conversions_target: number | null
          counsellor_id: string
          created_at: string | null
          followups_target: number | null
          id: string
          period: string
          period_start: string
          updated_at: string | null
          visits_target: number | null
          whatsapps_target: number | null
        }
        Insert: {
          calls_target?: number | null
          conversions_target?: number | null
          counsellor_id: string
          created_at?: string | null
          followups_target?: number | null
          id?: string
          period: string
          period_start: string
          updated_at?: string | null
          visits_target?: number | null
          whatsapps_target?: number | null
        }
        Update: {
          calls_target?: number | null
          conversions_target?: number | null
          counsellor_id?: string
          created_at?: string | null
          followups_target?: number | null
          id?: string
          period?: string
          period_start?: string
          updated_at?: string | null
          visits_target?: number | null
          whatsapps_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "counsellor_targets_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "counsellor_targets_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "counsellor_targets_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "counsellor_targets_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counsellor_targets_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      courses: {
        Row: {
          affiliations: string[] | null
          bg_video_url: string | null
          career_options: string[] | null
          code: string
          commission_amount: number | null
          course_summary: string | null
          cover_image_url: string | null
          created_at: string
          curriculum_url: string | null
          department_id: string
          description: string | null
          description_html: string | null
          display_order: number | null
          duration_years: number
          eligibility: string | null
          entrance_exam: string | null
          entrance_mandatory: boolean | null
          fee_notes: string | null
          fee_per_year: number | null
          fee_total: number | null
          highlights: string[] | null
          id: string
          is_active: boolean | null
          name: string
          seats: number | null
          slug: string | null
          type: string
          video_url_en: string | null
          video_url_hi: string | null
          webflow_slug: string | null
        }
        Insert: {
          affiliations?: string[] | null
          bg_video_url?: string | null
          career_options?: string[] | null
          code: string
          commission_amount?: number | null
          course_summary?: string | null
          cover_image_url?: string | null
          created_at?: string
          curriculum_url?: string | null
          department_id: string
          description?: string | null
          description_html?: string | null
          display_order?: number | null
          duration_years?: number
          eligibility?: string | null
          entrance_exam?: string | null
          entrance_mandatory?: boolean | null
          fee_notes?: string | null
          fee_per_year?: number | null
          fee_total?: number | null
          highlights?: string[] | null
          id?: string
          is_active?: boolean | null
          name: string
          seats?: number | null
          slug?: string | null
          type?: string
          video_url_en?: string | null
          video_url_hi?: string | null
          webflow_slug?: string | null
        }
        Update: {
          affiliations?: string[] | null
          bg_video_url?: string | null
          career_options?: string[] | null
          code?: string
          commission_amount?: number | null
          course_summary?: string | null
          cover_image_url?: string | null
          created_at?: string
          curriculum_url?: string | null
          department_id?: string
          description?: string | null
          description_html?: string | null
          display_order?: number | null
          duration_years?: number
          eligibility?: string | null
          entrance_exam?: string | null
          entrance_mandatory?: boolean | null
          fee_notes?: string | null
          fee_per_year?: number | null
          fee_total?: number | null
          highlights?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          seats?: number | null
          slug?: string | null
          type?: string
          video_url_en?: string | null
          video_url_hi?: string | null
          webflow_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["department_id"]
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
          color: string | null
          created_at: string
          id: string
          institution_id: string
          name: string
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          id?: string
          institution_id: string
          name: string
        }
        Update: {
          code?: string
          color?: string | null
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
      document_checklists: {
        Row: {
          course_id: string
          created_at: string | null
          document_name: string
          id: string
          is_required: boolean | null
          sort_order: number | null
        }
        Insert: {
          course_id: string
          created_at?: string | null
          document_name: string
          id?: string
          is_required?: boolean | null
          sort_order?: number | null
        }
        Update: {
          course_id?: string
          created_at?: string | null
          document_name?: string
          id?: string
          is_required?: boolean | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_checklists_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "document_checklists_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "document_checklists_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_checklists_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
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
          intake_capacity: number | null
          max_age: number | null
          min_age: number | null
          notes: string | null
          nri_fee_multiplier: number | null
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
          intake_capacity?: number | null
          max_age?: number | null
          min_age?: number | null
          notes?: string | null
          nri_fee_multiplier?: number | null
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
          intake_capacity?: number | null
          max_age?: number | null
          min_age?: number | null
          notes?: string | null
          nri_fee_multiplier?: number | null
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
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "eligibility_rules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "eligibility_rules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_rules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_html: string
          created_at: string | null
          from_email: string | null
          id: string
          lead_id: string | null
          provider_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string | null
          subject: string
          template_id: string | null
          to_email: string
        }
        Insert: {
          body_html: string
          created_at?: string | null
          from_email?: string | null
          id?: string
          lead_id?: string | null
          provider_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          subject: string
          template_id?: string | null
          to_email: string
        }
        Update: {
          body_html?: string
          created_at?: string | null
          from_email?: string | null
          id?: string
          lead_id?: string | null
          provider_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          subject?: string
          template_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "email_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "email_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "email_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "email_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string
          subject: string
          updated_at: string | null
          variables: string[] | null
        }
        Insert: {
          body_html: string
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug: string
          subject: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Update: {
          body_html?: string
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string
          subject?: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Relationships: []
      }
      employee_attendance: {
        Row: {
          campus_id: string | null
          created_at: string | null
          date: string
          device_id: string | null
          id: string
          location_lat: number | null
          location_lng: number | null
          notes: string | null
          punch_in: string | null
          punch_out: string | null
          selfie_url: string | null
          user_id: string
        }
        Insert: {
          campus_id?: string | null
          created_at?: string | null
          date?: string
          device_id?: string | null
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          notes?: string | null
          punch_in?: string | null
          punch_out?: string | null
          selfie_url?: string | null
          user_id: string
        }
        Update: {
          campus_id?: string | null
          created_at?: string | null
          date?: string
          device_id?: string | null
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          notes?: string | null
          punch_in?: string | null
          punch_out?: string | null
          selfie_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_attendance_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_attendance_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
        ]
      }
      employee_leave_balances: {
        Row: {
          created_at: string | null
          id: string
          leave_type: string
          total_days: number
          used_days: number
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          leave_type: string
          total_days?: number
          used_days?: number
          user_id: string
          year?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          leave_type?: string
          total_days?: number
          used_days?: number
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      employee_leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          days: number
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          start_date: string
          status: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          days: number
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          start_date: string
          status?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          days?: number
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          start_date?: string
          status?: string
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "employee_profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "employee_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["department_id"]
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
          fee_structure_item_id: string | null
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
          fee_structure_item_id?: string | null
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
          fee_structure_item_id?: string | null
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
            foreignKeyName: "fee_ledger_fee_structure_item_id_fkey"
            columns: ["fee_structure_item_id"]
            isOneToOne: false
            referencedRelation: "fee_structure_items"
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
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "fee_structures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "fee_structures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
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
      feedback_responses: {
        Row: {
          counsellor_id: string
          created_at: string | null
          feedback_text: string | null
          id: string
          interaction_id: string | null
          interaction_type: string
          lead_id: string
          rating: number | null
          responded_at: string | null
          sent_at: string | null
          status: string
          wa_message_id: string | null
        }
        Insert: {
          counsellor_id: string
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          interaction_id?: string | null
          interaction_type: string
          lead_id: string
          rating?: number | null
          responded_at?: string | null
          sent_at?: string | null
          status?: string
          wa_message_id?: string | null
        }
        Update: {
          counsellor_id?: string
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          interaction_id?: string | null
          interaction_type?: string
          lead_id?: string
          rating?: number | null
          responded_at?: string | null
          sent_at?: string | null
          status?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_action_journal: {
        Row: {
          action_type: string | null
          approved_by: string | null
          created_at: string
          description: string | null
          evidence_urls: Json | null
          id: string
          learner_profile_ids: string[] | null
          status: string
          student_id: string
          teacher_comment: string | null
          title: string
          unit_id: string | null
        }
        Insert: {
          action_type?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          evidence_urls?: Json | null
          id?: string
          learner_profile_ids?: string[] | null
          status?: string
          student_id: string
          teacher_comment?: string | null
          title: string
          unit_id?: string | null
        }
        Update: {
          action_type?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          evidence_urls?: Json | null
          id?: string
          learner_profile_ids?: string[] | null
          status?: string
          student_id?: string
          teacher_comment?: string | null
          title?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ib_action_journal_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_action_journal_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ib_units"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_assessment_results: {
        Row: {
          anecdotal_comment: string | null
          assessment_id: string
          atl_skill_ids: string[] | null
          created_at: string
          criterion_scores: Json | null
          criterion_total: number | null
          graded_by: string | null
          id: string
          learner_profile_ids: string[] | null
          myp_grade: number | null
          points_earned: number | null
          rubric_level: number | null
          student_id: string
          submitted_at: string | null
          teacher_comment: string | null
          updated_at: string
        }
        Insert: {
          anecdotal_comment?: string | null
          assessment_id: string
          atl_skill_ids?: string[] | null
          created_at?: string
          criterion_scores?: Json | null
          criterion_total?: number | null
          graded_by?: string | null
          id?: string
          learner_profile_ids?: string[] | null
          myp_grade?: number | null
          points_earned?: number | null
          rubric_level?: number | null
          student_id: string
          submitted_at?: string | null
          teacher_comment?: string | null
          updated_at?: string
        }
        Update: {
          anecdotal_comment?: string | null
          assessment_id?: string
          atl_skill_ids?: string[] | null
          created_at?: string
          criterion_scores?: Json | null
          criterion_total?: number | null
          graded_by?: string | null
          id?: string
          learner_profile_ids?: string[] | null
          myp_grade?: number | null
          points_earned?: number | null
          rubric_level?: number | null
          student_id?: string
          submitted_at?: string | null
          teacher_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_assessment_results_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "ib_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_assessment_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_assessments: {
        Row: {
          assigned_date: string | null
          batch_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          grading_model: string
          id: string
          max_points: number | null
          programme: Database["public"]["Enums"]["ib_programme"]
          rubric: Json | null
          status: string
          subject: string | null
          subject_group_id: string | null
          title: string
          type: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_date?: string | null
          batch_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          grading_model?: string
          id?: string
          max_points?: number | null
          programme: Database["public"]["Enums"]["ib_programme"]
          rubric?: Json | null
          status?: string
          subject?: string | null
          subject_group_id?: string | null
          title: string
          type: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_date?: string | null
          batch_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          grading_model?: string
          id?: string
          max_points?: number | null
          programme?: Database["public"]["Enums"]["ib_programme"]
          rubric?: Json | null
          status?: string
          subject?: string | null
          subject_group_id?: string | null
          title?: string
          type?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_assessments_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_assessments_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_assessments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ib_units"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_atl_categories: {
        Row: {
          id: string
          name: string
          programme: Database["public"]["Enums"]["ib_programme"] | null
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          programme?: Database["public"]["Enums"]["ib_programme"] | null
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          programme?: Database["public"]["Enums"]["ib_programme"] | null
          sort_order?: number
        }
        Relationships: []
      }
      ib_atl_skills: {
        Row: {
          category_id: string
          descriptor: string | null
          id: string
          name: string
          programme: Database["public"]["Enums"]["ib_programme"] | null
          sort_order: number
        }
        Insert: {
          category_id: string
          descriptor?: string | null
          id?: string
          name: string
          programme?: Database["public"]["Enums"]["ib_programme"] | null
          sort_order?: number
        }
        Update: {
          category_id?: string
          descriptor?: string | null
          id?: string
          name?: string
          programme?: Database["public"]["Enums"]["ib_programme"] | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ib_atl_skills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ib_atl_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_exhibition_students: {
        Row: {
          exhibition_id: string
          id: string
          role: string | null
          student_id: string
        }
        Insert: {
          exhibition_id: string
          id?: string
          role?: string | null
          student_id: string
        }
        Update: {
          exhibition_id?: string
          id?: string
          role?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_exhibition_students_exhibition_id_fkey"
            columns: ["exhibition_id"]
            isOneToOne: false
            referencedRelation: "ib_exhibitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_exhibition_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_exhibitions: {
        Row: {
          academic_year: string
          action_plan: string | null
          batch_id: string
          central_idea: string | null
          created_at: string
          id: string
          issue: string | null
          mentor_user_id: string | null
          presentation_date: string | null
          research_notes: string | null
          status: string
          td_theme_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          action_plan?: string | null
          batch_id: string
          central_idea?: string | null
          created_at?: string
          id?: string
          issue?: string | null
          mentor_user_id?: string | null
          presentation_date?: string | null
          research_notes?: string | null
          status?: string
          td_theme_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          action_plan?: string | null
          batch_id?: string
          central_idea?: string | null
          created_at?: string
          id?: string
          issue?: string | null
          mentor_user_id?: string | null
          presentation_date?: string | null
          research_notes?: string | null
          status?: string
          td_theme_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_exhibitions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_exhibitions_td_theme_id_fkey"
            columns: ["td_theme_id"]
            isOneToOne: false
            referencedRelation: "ib_td_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_global_contexts: {
        Row: {
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      ib_gradebook_snapshots: {
        Row: {
          academic_year: string
          achievement_level: string | null
          atl_assessment: Json | null
          batch_id: string
          created_at: string
          criterion_scores: Json | null
          final_grade: number | null
          id: string
          learner_profile_notes: Json | null
          overall_comment: string | null
          programme: Database["public"]["Enums"]["ib_programme"]
          student_id: string
          subject: string | null
          subject_group_id: string | null
          term: string
        }
        Insert: {
          academic_year: string
          achievement_level?: string | null
          atl_assessment?: Json | null
          batch_id: string
          created_at?: string
          criterion_scores?: Json | null
          final_grade?: number | null
          id?: string
          learner_profile_notes?: Json | null
          overall_comment?: string | null
          programme: Database["public"]["Enums"]["ib_programme"]
          student_id: string
          subject?: string | null
          subject_group_id?: string | null
          term: string
        }
        Update: {
          academic_year?: string
          achievement_level?: string | null
          atl_assessment?: Json | null
          batch_id?: string
          created_at?: string
          criterion_scores?: Json | null
          final_grade?: number | null
          id?: string
          learner_profile_notes?: Json | null
          overall_comment?: string | null
          programme?: Database["public"]["Enums"]["ib_programme"]
          student_id?: string
          subject?: string | null
          subject_group_id?: string | null
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_gradebook_snapshots_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_gradebook_snapshots_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_gradebook_snapshots_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_idu_results: {
        Row: {
          criterion_a: number | null
          criterion_b: number | null
          criterion_c: number | null
          id: string
          idu_id: string
          student_id: string
          teacher_comment: string | null
          total: number | null
        }
        Insert: {
          criterion_a?: number | null
          criterion_b?: number | null
          criterion_c?: number | null
          id?: string
          idu_id: string
          student_id: string
          teacher_comment?: string | null
          total?: number | null
        }
        Update: {
          criterion_a?: number | null
          criterion_b?: number | null
          criterion_c?: number | null
          id?: string
          idu_id?: string
          student_id?: string
          teacher_comment?: string | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ib_idu_results_idu_id_fkey"
            columns: ["idu_id"]
            isOneToOne: false
            referencedRelation: "ib_interdisciplinary_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_idu_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_idu_teachers: {
        Row: {
          id: string
          idu_id: string
          subject_group_id: string | null
          teacher_user_id: string
        }
        Insert: {
          id?: string
          idu_id: string
          subject_group_id?: string | null
          teacher_user_id: string
        }
        Update: {
          id?: string
          idu_id?: string
          subject_group_id?: string | null
          teacher_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_idu_teachers_idu_id_fkey"
            columns: ["idu_id"]
            isOneToOne: false
            referencedRelation: "ib_interdisciplinary_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_idu_teachers_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_interdisciplinary_units: {
        Row: {
          academic_year: string
          assessment_task: string | null
          atl_skill_ids: string[] | null
          batch_id: string
          created_at: string
          global_context_id: string | null
          id: string
          institution_id: string
          key_concept_ids: string[] | null
          related_concept_ids: string[] | null
          statement_of_inquiry: string | null
          status: string
          subject_group_1_id: string
          subject_group_2_id: string
          title: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          assessment_task?: string | null
          atl_skill_ids?: string[] | null
          batch_id: string
          created_at?: string
          global_context_id?: string | null
          id?: string
          institution_id: string
          key_concept_ids?: string[] | null
          related_concept_ids?: string[] | null
          statement_of_inquiry?: string | null
          status?: string
          subject_group_1_id: string
          subject_group_2_id: string
          title: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          assessment_task?: string | null
          atl_skill_ids?: string[] | null
          batch_id?: string
          created_at?: string
          global_context_id?: string | null
          id?: string
          institution_id?: string
          key_concept_ids?: string[] | null
          related_concept_ids?: string[] | null
          statement_of_inquiry?: string | null
          status?: string
          subject_group_1_id?: string
          subject_group_2_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_interdisciplinary_units_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_interdisciplinary_units_global_context_id_fkey"
            columns: ["global_context_id"]
            isOneToOne: false
            referencedRelation: "ib_global_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_interdisciplinary_units_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_interdisciplinary_units_subject_group_1_id_fkey"
            columns: ["subject_group_1_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_interdisciplinary_units_subject_group_2_id_fkey"
            columns: ["subject_group_2_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_key_concepts: {
        Row: {
          description: string | null
          id: string
          name: string
          programme: Database["public"]["Enums"]["ib_programme"]
          sort_order: number
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
          programme: Database["public"]["Enums"]["ib_programme"]
          sort_order?: number
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
          programme?: Database["public"]["Enums"]["ib_programme"]
          sort_order?: number
        }
        Relationships: []
      }
      ib_learner_profile_attributes: {
        Row: {
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      ib_lessons: {
        Row: {
          activities: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          materials: string[] | null
          objectives: string[] | null
          scheduled_date: string | null
          sort_order: number
          title: string
          unit_id: string
          week_number: number | null
        }
        Insert: {
          activities?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          materials?: string[] | null
          objectives?: string[] | null
          scheduled_date?: string | null
          sort_order?: number
          title: string
          unit_id: string
          week_number?: number | null
        }
        Update: {
          activities?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          materials?: string[] | null
          objectives?: string[] | null
          scheduled_date?: string | null
          sort_order?: number
          title?: string
          unit_id?: string
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ib_lessons_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ib_units"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_myp_criteria: {
        Row: {
          id: string
          letter: string
          max_level: number
          name: string
          subject_group_id: string
        }
        Insert: {
          id?: string
          letter: string
          max_level?: number
          name: string
          subject_group_id: string
        }
        Update: {
          id?: string
          letter?: string
          max_level?: number
          name?: string
          subject_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_myp_criteria_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_myp_grade_boundaries: {
        Row: {
          academic_year: string
          grade_1_min: number
          grade_2_min: number
          grade_3_min: number
          grade_4_min: number
          grade_5_min: number
          grade_6_min: number
          grade_7_min: number
          id: string
          subject_group_id: string
        }
        Insert: {
          academic_year: string
          grade_1_min?: number
          grade_2_min?: number
          grade_3_min?: number
          grade_4_min?: number
          grade_5_min?: number
          grade_6_min?: number
          grade_7_min?: number
          id?: string
          subject_group_id: string
        }
        Update: {
          academic_year?: string
          grade_1_min?: number
          grade_2_min?: number
          grade_3_min?: number
          grade_4_min?: number
          grade_5_min?: number
          grade_6_min?: number
          grade_7_min?: number
          id?: string
          subject_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_myp_grade_boundaries_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_myp_projects: {
        Row: {
          academic_year: string
          batch_id: string
          created_at: string
          criterion_scores: Json | null
          final_grade: number | null
          global_context_id: string | null
          goal: string | null
          id: string
          presentation_date: string | null
          process_journal: Json | null
          product_description: string | null
          project_type: string
          status: string
          student_id: string
          supervisor_feedback: Json | null
          supervisor_user_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          batch_id: string
          created_at?: string
          criterion_scores?: Json | null
          final_grade?: number | null
          global_context_id?: string | null
          goal?: string | null
          id?: string
          presentation_date?: string | null
          process_journal?: Json | null
          product_description?: string | null
          project_type: string
          status?: string
          student_id: string
          supervisor_feedback?: Json | null
          supervisor_user_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          batch_id?: string
          created_at?: string
          criterion_scores?: Json | null
          final_grade?: number | null
          global_context_id?: string | null
          goal?: string | null
          id?: string
          presentation_date?: string | null
          process_journal?: Json | null
          product_description?: string | null
          project_type?: string
          status?: string
          student_id?: string
          supervisor_feedback?: Json | null
          supervisor_user_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_myp_projects_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_myp_projects_global_context_id_fkey"
            columns: ["global_context_id"]
            isOneToOne: false
            referencedRelation: "ib_global_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_myp_projects_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_myp_subject_groups: {
        Row: {
          code: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      ib_poi: {
        Row: {
          academic_year: string
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          status: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_poi_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_poi_entries: {
        Row: {
          central_idea: string | null
          course_id: string
          created_at: string
          duration_weeks: number | null
          id: string
          key_concepts: string[] | null
          lines_of_inquiry: string[] | null
          poi_id: string
          related_concepts: string[] | null
          sort_order: number
          start_date: string | null
          teacher_questions: string | null
          theme_id: string
          updated_at: string
        }
        Insert: {
          central_idea?: string | null
          course_id: string
          created_at?: string
          duration_weeks?: number | null
          id?: string
          key_concepts?: string[] | null
          lines_of_inquiry?: string[] | null
          poi_id: string
          related_concepts?: string[] | null
          sort_order?: number
          start_date?: string | null
          teacher_questions?: string | null
          theme_id: string
          updated_at?: string
        }
        Update: {
          central_idea?: string | null
          course_id?: string
          created_at?: string
          duration_weeks?: number | null
          id?: string
          key_concepts?: string[] | null
          lines_of_inquiry?: string[] | null
          poi_id?: string
          related_concepts?: string[] | null
          sort_order?: number
          start_date?: string | null
          teacher_questions?: string | null
          theme_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_poi_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "ib_poi_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "ib_poi_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_poi_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "ib_poi_entries_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "ib_poi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_poi_entries_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "ib_td_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_portfolio_entries: {
        Row: {
          atl_skill_ids: string[] | null
          content_text: string | null
          created_at: string
          created_by: string | null
          description: string | null
          entry_type: string
          file_urls: Json | null
          id: string
          is_exhibition: boolean | null
          key_concept_ids: string[] | null
          learner_profile_ids: string[] | null
          programme: Database["public"]["Enums"]["ib_programme"]
          student_id: string
          teacher_comment: string | null
          title: string
          unit_id: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          atl_skill_ids?: string[] | null
          content_text?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_type: string
          file_urls?: Json | null
          id?: string
          is_exhibition?: boolean | null
          key_concept_ids?: string[] | null
          learner_profile_ids?: string[] | null
          programme: Database["public"]["Enums"]["ib_programme"]
          student_id: string
          teacher_comment?: string | null
          title: string
          unit_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          atl_skill_ids?: string[] | null
          content_text?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_type?: string
          file_urls?: Json | null
          id?: string
          is_exhibition?: boolean | null
          key_concept_ids?: string[] | null
          learner_profile_ids?: string[] | null
          programme?: Database["public"]["Enums"]["ib_programme"]
          student_id?: string
          teacher_comment?: string | null
          title?: string
          unit_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_portfolio_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_portfolio_entries_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ib_units"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_report_cards: {
        Row: {
          academic_year: string
          batch_id: string
          coordinator_comment: string | null
          created_at: string
          homeroom_comment: string | null
          id: string
          pdf_url: string | null
          principal_comment: string | null
          published_at: string | null
          report_data: Json
          status: string
          student_id: string
          template_id: string
          term: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          batch_id: string
          coordinator_comment?: string | null
          created_at?: string
          homeroom_comment?: string | null
          id?: string
          pdf_url?: string | null
          principal_comment?: string | null
          published_at?: string | null
          report_data?: Json
          status?: string
          student_id: string
          template_id: string
          term: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          batch_id?: string
          coordinator_comment?: string | null
          created_at?: string
          homeroom_comment?: string | null
          id?: string
          pdf_url?: string | null
          principal_comment?: string | null
          published_at?: string | null
          report_data?: Json
          status?: string
          student_id?: string
          template_id?: string
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_report_cards_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_report_cards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_report_cards_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ib_report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_report_templates: {
        Row: {
          academic_year: string
          created_at: string
          footer_text: string | null
          header_config: Json | null
          id: string
          institution_id: string
          is_default: boolean | null
          name: string
          programme: Database["public"]["Enums"]["ib_programme"]
          sections: Json
          status: string
          term: string
        }
        Insert: {
          academic_year: string
          created_at?: string
          footer_text?: string | null
          header_config?: Json | null
          id?: string
          institution_id: string
          is_default?: boolean | null
          name: string
          programme: Database["public"]["Enums"]["ib_programme"]
          sections?: Json
          status?: string
          term: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          footer_text?: string | null
          header_config?: Json | null
          id?: string
          institution_id?: string
          is_default?: boolean | null
          name?: string
          programme?: Database["public"]["Enums"]["ib_programme"]
          sections?: Json
          status?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_report_templates_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_service_as_action: {
        Row: {
          activity_type: string | null
          created_at: string
          description: string | null
          hours_completed: number | null
          id: string
          learning_outcomes: Json | null
          reflections: Json | null
          status: string
          student_id: string
          supervisor_comment: string | null
          supervisor_name: string | null
          title: string
          updated_at: string
        }
        Insert: {
          activity_type?: string | null
          created_at?: string
          description?: string | null
          hours_completed?: number | null
          id?: string
          learning_outcomes?: Json | null
          reflections?: Json | null
          status?: string
          student_id: string
          supervisor_comment?: string | null
          supervisor_name?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          activity_type?: string | null
          created_at?: string
          description?: string | null
          hours_completed?: number | null
          id?: string
          learning_outcomes?: Json | null
          reflections?: Json | null
          status?: string
          student_id?: string
          supervisor_comment?: string | null
          supervisor_name?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_service_as_action_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_td_themes: {
        Row: {
          central_idea_prompt: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          central_idea_prompt?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          central_idea_prompt?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      ib_teacher_assignments: {
        Row: {
          academic_year: string
          batch_id: string
          created_at: string
          id: string
          is_homeroom: boolean
          subject: string | null
          subject_group_id: string | null
          teacher_user_id: string
        }
        Insert: {
          academic_year: string
          batch_id: string
          created_at?: string
          id?: string
          is_homeroom?: boolean
          subject?: string | null
          subject_group_id?: string | null
          teacher_user_id: string
        }
        Update: {
          academic_year?: string
          batch_id?: string
          created_at?: string
          id?: string
          is_homeroom?: boolean
          subject?: string | null
          subject_group_id?: string | null
          teacher_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_teacher_assignments_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_teacher_assignments_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_unit_collaborators: {
        Row: {
          id: string
          role: string
          unit_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role?: string
          unit_id: string
          user_id: string
        }
        Update: {
          id?: string
          role?: string
          unit_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_unit_collaborators_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ib_units"
            referencedColumns: ["id"]
          },
        ]
      }
      ib_units: {
        Row: {
          action_teaching_strategies: string | null
          atl_skill_ids: string[] | null
          batch_id: string
          central_idea: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          formative_assessments: Json | null
          global_context_id: string | null
          id: string
          inquiry_questions: Json | null
          institution_id: string
          key_concept_ids: string[] | null
          learner_profile_ids: string[] | null
          learning_experiences: Json | null
          poi_entry_id: string | null
          programme: Database["public"]["Enums"]["ib_programme"]
          reflection: string | null
          related_concept_ids: string[] | null
          resources: Json | null
          start_date: string | null
          statement_of_inquiry: string | null
          status: string
          subject_focus: string | null
          subject_group_id: string | null
          summative_assessment: string | null
          teacher_questions: string | null
          title: string
          updated_at: string
        }
        Insert: {
          action_teaching_strategies?: string | null
          atl_skill_ids?: string[] | null
          batch_id: string
          central_idea?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          formative_assessments?: Json | null
          global_context_id?: string | null
          id?: string
          inquiry_questions?: Json | null
          institution_id: string
          key_concept_ids?: string[] | null
          learner_profile_ids?: string[] | null
          learning_experiences?: Json | null
          poi_entry_id?: string | null
          programme: Database["public"]["Enums"]["ib_programme"]
          reflection?: string | null
          related_concept_ids?: string[] | null
          resources?: Json | null
          start_date?: string | null
          statement_of_inquiry?: string | null
          status?: string
          subject_focus?: string | null
          subject_group_id?: string | null
          summative_assessment?: string | null
          teacher_questions?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          action_teaching_strategies?: string | null
          atl_skill_ids?: string[] | null
          batch_id?: string
          central_idea?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          formative_assessments?: Json | null
          global_context_id?: string | null
          id?: string
          inquiry_questions?: Json | null
          institution_id?: string
          key_concept_ids?: string[] | null
          learner_profile_ids?: string[] | null
          learning_experiences?: Json | null
          poi_entry_id?: string | null
          programme?: Database["public"]["Enums"]["ib_programme"]
          reflection?: string | null
          related_concept_ids?: string[] | null
          resources?: Json | null
          start_date?: string | null
          statement_of_inquiry?: string | null
          status?: string
          subject_focus?: string | null
          subject_group_id?: string | null
          summative_assessment?: string | null
          teacher_questions?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ib_units_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_units_global_context_id_fkey"
            columns: ["global_context_id"]
            isOneToOne: false
            referencedRelation: "ib_global_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_units_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_units_poi_entry_id_fkey"
            columns: ["poi_entry_id"]
            isOneToOne: false
            referencedRelation: "ib_poi_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ib_units_subject_group_id_fkey"
            columns: ["subject_group_id"]
            isOneToOne: false
            referencedRelation: "ib_myp_subject_groups"
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
          google_maps_url: string | null
          id: string
          name: string
          type: string
        }
        Insert: {
          campus_id: string
          code: string
          created_at?: string
          google_maps_url?: string | null
          id?: string
          name: string
          type: string
        }
        Update: {
          campus_id?: string
          code?: string
          created_at?: string
          google_maps_url?: string | null
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
          {
            foreignKeyName: "institutions_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
        ]
      }
      jd_category_mappings: {
        Row: {
          category: string
          course_id: string | null
          created_at: string
          id: string
          is_school: boolean
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          category: string
          course_id?: string | null
          created_at?: string
          id?: string
          is_school?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          category?: string
          course_id?: string | null
          created_at?: string
          id?: string
          is_school?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "jd_category_mappings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "jd_category_mappings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "jd_category_mappings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jd_category_mappings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      knowledge_gaps: {
        Row: {
          answer_text: string | null
          answered_at: string | null
          answered_by: string | null
          confidence_score: number
          context: Json
          created_at: string
          id: string
          query_text: string
          source: string
          status: string
        }
        Insert: {
          answer_text?: string | null
          answered_at?: string | null
          answered_by?: string | null
          confidence_score?: number
          context?: Json
          created_at?: string
          id?: string
          query_text: string
          source?: string
          status?: string
        }
        Update: {
          answer_text?: string | null
          answered_at?: string | null
          answered_by?: string | null
          confidence_score?: number
          context?: Json
          created_at?: string
          id?: string
          query_text?: string
          source?: string
          status?: string
        }
        Relationships: []
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
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_counsellors_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_counsellors_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "lead_counsellors_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_counsellors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_deletion_requests: {
        Row: {
          created_at: string
          custom_message: string | null
          id: string
          lead_id: string
          reason: string
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          custom_message?: string | null
          id?: string
          lead_id: string
          reason: string
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          custom_message?: string | null
          id?: string
          lead_id?: string
          reason?: string
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_deletion_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_documents: {
        Row: {
          checklist_item_id: string | null
          created_at: string | null
          document_name: string
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          lead_id: string
          rejection_reason: string | null
          status: string | null
          uploaded_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          checklist_item_id?: string | null
          created_at?: string | null
          document_name: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          lead_id: string
          rejection_reason?: string | null
          status?: string | null
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          checklist_item_id?: string | null
          created_at?: string | null
          document_name?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          lead_id?: string
          rejection_reason?: string | null
          status?: string | null
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_documents_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "document_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "lead_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_merges: {
        Row: {
          created_at: string | null
          id: string
          kept_lead_id: string
          merged_by: string | null
          merged_lead_id: string
          merged_lead_snapshot: Json
        }
        Insert: {
          created_at?: string | null
          id?: string
          kept_lead_id: string
          merged_by?: string | null
          merged_lead_id: string
          merged_lead_snapshot: Json
        }
        Update: {
          created_at?: string | null
          id?: string
          kept_lead_id?: string
          merged_by?: string | null
          merged_lead_id?: string
          merged_lead_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_kept_lead_id_fkey"
            columns: ["kept_lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "lead_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_payments: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          lead_id: string
          notes: string | null
          payment_date: string | null
          payment_mode: string
          receipt_no: string | null
          receipt_url: string | null
          recorded_by: string | null
          status: string | null
          transaction_ref: string | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          payment_date?: string | null
          payment_mode: string
          receipt_no?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          status?: string | null
          transaction_ref?: string | null
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          payment_date?: string | null
          payment_mode?: string
          receipt_no?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          status?: string | null
          transaction_ref?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "lead_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "lead_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      leads: {
        Row: {
          admission_no: string | null
          ai_call_duration_seconds: number | null
          ai_call_uuid: string | null
          ai_called: boolean
          ai_called_at: string | null
          ai_conversion_probability: number | null
          ai_notes: string | null
          ai_recording_url: string | null
          ai_transcript: string | null
          application_id: string | null
          application_progress: Json | null
          area: string | null
          assigned_at: string | null
          auto_returned_count: number
          campus_id: string | null
          category: string | null
          city: string | null
          consultant_id: string | null
          counsellor_id: string | null
          course_id: string | null
          created_at: string
          email: string | null
          entrance_scores: Json | null
          first_contact_at: string | null
          future_eligible_session: string | null
          gap_years: number | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          interview_result: string | null
          interview_score: number | null
          is_mirror: boolean
          is_nri: boolean | null
          jd_category: string | null
          lead_score: number | null
          lead_temperature: string | null
          mirror_lead_id: string | null
          name: string
          notes: string | null
          offer_amount: number | null
          person_role: string
          phone: string
          pre_admission_no: string | null
          secondary_source: string | null
          skip_ai_call: boolean | null
          source: Database["public"]["Enums"]["lead_source"]
          source_history: Json | null
          source_lead_id: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          state: string | null
          state_domicile: string | null
          tertiary_source: string | null
          token_amount: number | null
          updated_at: string
          visit_date: string | null
        }
        Insert: {
          admission_no?: string | null
          ai_call_duration_seconds?: number | null
          ai_call_uuid?: string | null
          ai_called?: boolean
          ai_called_at?: string | null
          ai_conversion_probability?: number | null
          ai_notes?: string | null
          ai_recording_url?: string | null
          ai_transcript?: string | null
          application_id?: string | null
          application_progress?: Json | null
          area?: string | null
          assigned_at?: string | null
          auto_returned_count?: number
          campus_id?: string | null
          category?: string | null
          city?: string | null
          consultant_id?: string | null
          counsellor_id?: string | null
          course_id?: string | null
          created_at?: string
          email?: string | null
          entrance_scores?: Json | null
          first_contact_at?: string | null
          future_eligible_session?: string | null
          gap_years?: number | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          interview_result?: string | null
          interview_score?: number | null
          is_mirror?: boolean
          is_nri?: boolean | null
          jd_category?: string | null
          lead_score?: number | null
          lead_temperature?: string | null
          mirror_lead_id?: string | null
          name: string
          notes?: string | null
          offer_amount?: number | null
          person_role?: string
          phone: string
          pre_admission_no?: string | null
          secondary_source?: string | null
          skip_ai_call?: boolean | null
          source?: Database["public"]["Enums"]["lead_source"]
          source_history?: Json | null
          source_lead_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          state?: string | null
          state_domicile?: string | null
          tertiary_source?: string | null
          token_amount?: number | null
          updated_at?: string
          visit_date?: string | null
        }
        Update: {
          admission_no?: string | null
          ai_call_duration_seconds?: number | null
          ai_call_uuid?: string | null
          ai_called?: boolean
          ai_called_at?: string | null
          ai_conversion_probability?: number | null
          ai_notes?: string | null
          ai_recording_url?: string | null
          ai_transcript?: string | null
          application_id?: string | null
          application_progress?: Json | null
          area?: string | null
          assigned_at?: string | null
          auto_returned_count?: number
          campus_id?: string | null
          category?: string | null
          city?: string | null
          consultant_id?: string | null
          counsellor_id?: string | null
          course_id?: string | null
          created_at?: string
          email?: string | null
          entrance_scores?: Json | null
          first_contact_at?: string | null
          future_eligible_session?: string | null
          gap_years?: number | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          interview_result?: string | null
          interview_score?: number | null
          is_mirror?: boolean
          is_nri?: boolean | null
          jd_category?: string | null
          lead_score?: number | null
          lead_temperature?: string | null
          mirror_lead_id?: string | null
          name?: string
          notes?: string | null
          offer_amount?: number | null
          person_role?: string
          phone?: string
          pre_admission_no?: string | null
          secondary_source?: string | null
          skip_ai_call?: boolean | null
          source?: Database["public"]["Enums"]["lead_source"]
          source_history?: Json | null
          source_lead_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          state?: string | null
          state_domicile?: string | null
          tertiary_source?: string | null
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
            foreignKeyName: "leads_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_dashboard"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_roi_summary"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_mirror_lead_id_fkey"
            columns: ["mirror_lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          lead_id: string | null
          link: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          link?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          link?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_letters: {
        Row: {
          acceptance_deadline: string | null
          accepted_at: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          campus_id: string | null
          course_id: string | null
          created_at: string
          id: string
          issued_by: string | null
          lead_id: string
          net_fee: number
          rejection_reason: string | null
          scholarship_amount: number | null
          status: string
          total_fee: number
        }
        Insert: {
          acceptance_deadline?: string | null
          accepted_at?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          issued_by?: string | null
          lead_id: string
          net_fee: number
          rejection_reason?: string | null
          scholarship_amount?: number | null
          status?: string
          total_fee: number
        }
        Update: {
          acceptance_deadline?: string | null
          accepted_at?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          campus_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          issued_by?: string | null
          lead_id?: string
          net_fee?: number
          rejection_reason?: string | null
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
            foreignKeyName: "offer_letters_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "offer_letters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "offer_letters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "offer_letters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_letters_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
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
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
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
      permissions: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          module: string
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          module: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          module?: string
        }
        Relationships: []
      }
      pg_transactions: {
        Row: {
          amount: number
          context: string
          context_id: string | null
          created_at: string
          gateway: string | null
          gateway_ref: string | null
          id: string
          payer_email: string | null
          payer_name: string | null
          payer_phone: string | null
          product_info: string | null
          raw_response: Json | null
          status: string
          txn_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          context: string
          context_id?: string | null
          created_at?: string
          gateway?: string | null
          gateway_ref?: string | null
          id?: string
          payer_email?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          product_info?: string | null
          raw_response?: Json | null
          status?: string
          txn_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          context?: string
          context_id?: string | null
          created_at?: string
          gateway?: string | null
          gateway_ref?: string | null
          id?: string
          payer_email?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          product_info?: string | null
          raw_response?: Json | null
          status?: string
          txn_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          campus: string | null
          consultant_tour_completed: boolean | null
          created_at: string
          department: string | null
          display_name: string | null
          email: string | null
          id: string
          institution: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          campus?: string | null
          consultant_tour_completed?: boolean | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          institution?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          campus?: string | null
          consultant_tour_completed?: boolean | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          institution?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      publishers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          source: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      score_penalty_log: {
        Row: {
          counsellor_id: string
          created_at: string | null
          id: string
          lead_id: string | null
          penalty_date: string
          penalty_type: string
        }
        Insert: {
          counsellor_id: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          penalty_date?: string
          penalty_type: string
        }
        Update: {
          counsellor_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          penalty_date?: string
          penalty_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_penalty_log_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "score_penalty_log_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "score_penalty_log_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "score_penalty_log_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalty_log_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalty_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      source_ad_spend: {
        Row: {
          amount: number
          campus_id: string | null
          created_at: string | null
          id: string
          month: string
          notes: string | null
          recorded_by: string | null
          source: string
          updated_at: string | null
        }
        Insert: {
          amount?: number
          campus_id?: string | null
          created_at?: string | null
          id?: string
          month: string
          notes?: string | null
          recorded_by?: string | null
          source: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          campus_id?: string | null
          created_at?: string | null
          id?: string
          month?: string
          notes?: string | null
          recorded_by?: string | null
          source?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_ad_spend_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_ad_spend_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "source_ad_spend_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "source_ad_spend_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "source_ad_spend_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "source_ad_spend_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_ad_spend_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      stage_inactivity_thresholds: {
        Row: {
          created_at: string | null
          id: string
          max_inactive_days: number
          stage: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_inactive_days?: number
          stage: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          max_inactive_days?: number
          stage?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      stage_sla_config: {
        Row: {
          checkin_interval_hours: number | null
          checkin_warning_hours: number | null
          created_at: string | null
          first_contact_hours: number
          id: string
          stage: string
          warning_hours: number
        }
        Insert: {
          checkin_interval_hours?: number | null
          checkin_warning_hours?: number | null
          created_at?: string | null
          first_contact_hours?: number
          id?: string
          stage: string
          warning_hours?: number
        }
        Update: {
          checkin_interval_hours?: number | null
          checkin_warning_hours?: number | null
          created_at?: string | null
          first_contact_hours?: number
          id?: string
          stage?: string
          warning_hours?: number
        }
        Relationships: []
      }
      student_referrals: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          referred_campus_id: string | null
          referred_course_id: string | null
          referred_email: string | null
          referred_name: string
          referred_phone: string
          referrer_student_id: string
          referrer_user_id: string | null
          relationship: string | null
          reward_amount: number | null
          reward_applied_at: string | null
          reward_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          referred_campus_id?: string | null
          referred_course_id?: string | null
          referred_email?: string | null
          referred_name: string
          referred_phone: string
          referrer_student_id: string
          referrer_user_id?: string | null
          relationship?: string | null
          reward_amount?: number | null
          reward_applied_at?: string | null
          reward_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          referred_campus_id?: string | null
          referred_course_id?: string | null
          referred_email?: string | null
          referred_name?: string
          referred_phone?: string
          referrer_student_id?: string
          referrer_user_id?: string | null
          relationship?: string | null
          reward_amount?: number | null
          reward_applied_at?: string | null
          reward_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_referred_campus_id_fkey"
            columns: ["referred_campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_referred_campus_id_fkey"
            columns: ["referred_campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "student_referrals_referred_course_id_fkey"
            columns: ["referred_course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "student_referrals_referred_course_id_fkey"
            columns: ["referred_course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "student_referrals_referred_course_id_fkey"
            columns: ["referred_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_referrals_referred_course_id_fkey"
            columns: ["referred_course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "student_referrals_referrer_student_id_fkey"
            columns: ["referrer_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          address: string | null
          admission_date: string | null
          admission_no: string | null
          allergies_food: string | null
          allergies_medicine: string | null
          apaar_id: string | null
          bank_account_no: string | null
          bank_name: string | null
          bank_reference_no: string | null
          batch_id: string | null
          biometric_id: string | null
          birth_place: string | null
          blood_group: string | null
          campus_id: string | null
          caste: string | null
          caste_category: string | null
          city: string | null
          class_roll_no: string | null
          concession_category: string | null
          country: string | null
          course_id: string | null
          created_at: string
          created_by: string | null
          date_of_admission: string | null
          description: string | null
          dnd: boolean | null
          dob: string | null
          dob_certificate_submitted: boolean | null
          email: string | null
          father_aadhar: string | null
          father_designation: string | null
          father_email: string | null
          father_income: string | null
          father_name: string | null
          father_occupation: string | null
          father_organization: string | null
          father_phone: string | null
          father_qualification: string | null
          father_user_id: string | null
          father_whatsapp: string | null
          fee_profile_type: string | null
          fee_remarks: string | null
          fee_structure_version: string | null
          first_name: string | null
          food_habits: string | null
          form_filling_date: string | null
          gender: string | null
          guardian_name: string | null
          guardian_phone: string | null
          guardian_user_id: string | null
          hostel_type: string | null
          house: string | null
          id: string
          identification_marks_1: string | null
          identification_marks_2: string | null
          ifsc_code: string | null
          is_asthmatic: boolean | null
          joining_academic_year: string | null
          joining_class: string | null
          language_spoken: string | null
          last_name: string | null
          lead_id: string | null
          marksheet_submitted: boolean | null
          medical_ailments: string | null
          middle_name: string | null
          mother_aadhar: string | null
          mother_email: string | null
          mother_name: string | null
          mother_occupation: string | null
          mother_organization: string | null
          mother_phone: string | null
          mother_tongue: string | null
          mother_user_id: string | null
          mother_whatsapp: string | null
          name: string
          nationality: string | null
          ongoing_treatment: string | null
          pen: string | null
          phone: string | null
          photo_url: string | null
          physical_handicap: string | null
          pincode: string | null
          pre_admission_no: string | null
          previous_board: string | null
          previous_class: string | null
          previous_school: string | null
          religion: string | null
          rte_student: boolean | null
          school_admission_no: string | null
          school_email: string | null
          second_language: string | null
          section: string | null
          session_id: string | null
          sports: string | null
          sr_number: string | null
          star_information: string | null
          state: string | null
          state_enrollment_no: string | null
          status: Database["public"]["Enums"]["student_status"]
          student_aadhar: string | null
          student_email: string | null
          student_type: string | null
          sub_caste: string | null
          tc_submitted: boolean | null
          third_language: string | null
          transport_required: boolean | null
          transport_zone: string | null
          udise: string | null
          updated_at: string
          user_id: string | null
          vision: string | null
          whatsapp_no: string | null
        }
        Insert: {
          address?: string | null
          admission_date?: string | null
          admission_no?: string | null
          allergies_food?: string | null
          allergies_medicine?: string | null
          apaar_id?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          bank_reference_no?: string | null
          batch_id?: string | null
          biometric_id?: string | null
          birth_place?: string | null
          blood_group?: string | null
          campus_id?: string | null
          caste?: string | null
          caste_category?: string | null
          city?: string | null
          class_roll_no?: string | null
          concession_category?: string | null
          country?: string | null
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_admission?: string | null
          description?: string | null
          dnd?: boolean | null
          dob?: string | null
          dob_certificate_submitted?: boolean | null
          email?: string | null
          father_aadhar?: string | null
          father_designation?: string | null
          father_email?: string | null
          father_income?: string | null
          father_name?: string | null
          father_occupation?: string | null
          father_organization?: string | null
          father_phone?: string | null
          father_qualification?: string | null
          father_user_id?: string | null
          father_whatsapp?: string | null
          fee_profile_type?: string | null
          fee_remarks?: string | null
          fee_structure_version?: string | null
          first_name?: string | null
          food_habits?: string | null
          form_filling_date?: string | null
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          guardian_user_id?: string | null
          hostel_type?: string | null
          house?: string | null
          id?: string
          identification_marks_1?: string | null
          identification_marks_2?: string | null
          ifsc_code?: string | null
          is_asthmatic?: boolean | null
          joining_academic_year?: string | null
          joining_class?: string | null
          language_spoken?: string | null
          last_name?: string | null
          lead_id?: string | null
          marksheet_submitted?: boolean | null
          medical_ailments?: string | null
          middle_name?: string | null
          mother_aadhar?: string | null
          mother_email?: string | null
          mother_name?: string | null
          mother_occupation?: string | null
          mother_organization?: string | null
          mother_phone?: string | null
          mother_tongue?: string | null
          mother_user_id?: string | null
          mother_whatsapp?: string | null
          name: string
          nationality?: string | null
          ongoing_treatment?: string | null
          pen?: string | null
          phone?: string | null
          photo_url?: string | null
          physical_handicap?: string | null
          pincode?: string | null
          pre_admission_no?: string | null
          previous_board?: string | null
          previous_class?: string | null
          previous_school?: string | null
          religion?: string | null
          rte_student?: boolean | null
          school_admission_no?: string | null
          school_email?: string | null
          second_language?: string | null
          section?: string | null
          session_id?: string | null
          sports?: string | null
          sr_number?: string | null
          star_information?: string | null
          state?: string | null
          state_enrollment_no?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          student_aadhar?: string | null
          student_email?: string | null
          student_type?: string | null
          sub_caste?: string | null
          tc_submitted?: boolean | null
          third_language?: string | null
          transport_required?: boolean | null
          transport_zone?: string | null
          udise?: string | null
          updated_at?: string
          user_id?: string | null
          vision?: string | null
          whatsapp_no?: string | null
        }
        Update: {
          address?: string | null
          admission_date?: string | null
          admission_no?: string | null
          allergies_food?: string | null
          allergies_medicine?: string | null
          apaar_id?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          bank_reference_no?: string | null
          batch_id?: string | null
          biometric_id?: string | null
          birth_place?: string | null
          blood_group?: string | null
          campus_id?: string | null
          caste?: string | null
          caste_category?: string | null
          city?: string | null
          class_roll_no?: string | null
          concession_category?: string | null
          country?: string | null
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_admission?: string | null
          description?: string | null
          dnd?: boolean | null
          dob?: string | null
          dob_certificate_submitted?: boolean | null
          email?: string | null
          father_aadhar?: string | null
          father_designation?: string | null
          father_email?: string | null
          father_income?: string | null
          father_name?: string | null
          father_occupation?: string | null
          father_organization?: string | null
          father_phone?: string | null
          father_qualification?: string | null
          father_user_id?: string | null
          father_whatsapp?: string | null
          fee_profile_type?: string | null
          fee_remarks?: string | null
          fee_structure_version?: string | null
          first_name?: string | null
          food_habits?: string | null
          form_filling_date?: string | null
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          guardian_user_id?: string | null
          hostel_type?: string | null
          house?: string | null
          id?: string
          identification_marks_1?: string | null
          identification_marks_2?: string | null
          ifsc_code?: string | null
          is_asthmatic?: boolean | null
          joining_academic_year?: string | null
          joining_class?: string | null
          language_spoken?: string | null
          last_name?: string | null
          lead_id?: string | null
          marksheet_submitted?: boolean | null
          medical_ailments?: string | null
          middle_name?: string | null
          mother_aadhar?: string | null
          mother_email?: string | null
          mother_name?: string | null
          mother_occupation?: string | null
          mother_organization?: string | null
          mother_phone?: string | null
          mother_tongue?: string | null
          mother_user_id?: string | null
          mother_whatsapp?: string | null
          name?: string
          nationality?: string | null
          ongoing_treatment?: string | null
          pen?: string | null
          phone?: string | null
          photo_url?: string | null
          physical_handicap?: string | null
          pincode?: string | null
          pre_admission_no?: string | null
          previous_board?: string | null
          previous_class?: string | null
          previous_school?: string | null
          religion?: string | null
          rte_student?: boolean | null
          school_admission_no?: string | null
          school_email?: string | null
          second_language?: string | null
          section?: string | null
          session_id?: string | null
          sports?: string | null
          sr_number?: string | null
          star_information?: string | null
          state?: string | null
          state_enrollment_no?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          student_aadhar?: string | null
          student_email?: string | null
          student_type?: string | null
          sub_caste?: string | null
          tc_submitted?: boolean | null
          third_language?: string | null
          transport_required?: boolean | null
          transport_zone?: string | null
          udise?: string | null
          updated_at?: string
          user_id?: string | null
          vision?: string | null
          whatsapp_no?: string | null
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
            foreignKeyName: "students_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
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
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["team_id"]
          },
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
      user_permission_overrides: {
        Row: {
          created_at: string
          granted: boolean
          granted_by: string | null
          id: string
          permission_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          granted_by?: string | null
          id?: string
          permission_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          granted_by?: string | null
          id?: string
          permission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
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
      visit_followup_nudges: {
        Row: {
          counsellor_id: string
          id: string
          lead_id: string
          notified_at: string | null
          tier: number
          visit_id: string
        }
        Insert: {
          counsellor_id: string
          id?: string
          lead_id: string
          notified_at?: string | null
          tier: number
          visit_id: string
        }
        Update: {
          counsellor_id?: string
          id?: string
          lead_id?: string
          notified_at?: string | null
          tier?: number
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_followup_nudges_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_followup_nudges_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          campus_id: string | null
          course_id: string
          created_at: string | null
          id: string
          lead_id: string
          position: number
          promoted_at: string | null
          status: string | null
        }
        Insert: {
          campus_id?: string | null
          course_id: string
          created_at?: string | null
          id?: string
          lead_id: string
          position: number
          promoted_at?: string | null
          status?: string | null
        }
        Update: {
          campus_id?: string | null
          course_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string
          position?: number
          promoted_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "waitlist_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "waitlist_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "waitlist_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      web_conversations: {
        Row: {
          ended_at: string | null
          id: string
          lead_id: string
          messages: Json
          session_id: string
          started_at: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          lead_id: string
          messages?: Json
          session_id: string
          started_at?: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          lead_id?: string
          messages?: Json
          session_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string | null
          error_message: string | null
          id: string
          lead_id: string
          message_id: string | null
          phone: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          message_id?: string | null
          phone: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          message_id?: string | null
          phone?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaigns: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          failed_count: number | null
          filters: Json | null
          id: string
          name: string
          sent_count: number | null
          status: string | null
          template_key: string
          total_recipients: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          failed_count?: number | null
          filters?: Json | null
          id?: string
          name: string
          sent_count?: number | null
          status?: string | null
          template_key: string
          total_recipients?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          failed_count?: number | null
          filters?: Json | null
          id?: string
          name?: string
          sent_count?: number | null
          status?: string | null
          template_key?: string
          total_recipients?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          assigned_to: string | null
          content: string | null
          created_at: string | null
          direction: string
          id: string
          is_read: boolean | null
          lead_id: string | null
          media_url: string | null
          message_type: string | null
          phone: string
          read_at: string | null
          read_by: string | null
          status: string | null
          template_key: string | null
          wa_message_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          content?: string | null
          created_at?: string | null
          direction: string
          id?: string
          is_read?: boolean | null
          lead_id?: string | null
          media_url?: string | null
          message_type?: string | null
          phone: string
          read_at?: string | null
          read_by?: string | null
          status?: string | null
          template_key?: string | null
          wa_message_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string
          id?: string
          is_read?: boolean | null
          lead_id?: string | null
          media_url?: string | null
          message_type?: string | null
          phone?: string
          read_at?: string | null
          read_by?: string | null
          status?: string | null
          template_key?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
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
      alumni_pending_summary: {
        Row: {
          alumni_name: string | null
          contact_email: string | null
          course: string | null
          created_at: string | null
          days_remaining: number | null
          due_date: string | null
          employee_review_result: string | null
          employer_name: string | null
          fee_amount: number | null
          id: string | null
          is_overdue: boolean | null
          paid_at: string | null
          request_number: string | null
          request_type: string | null
          status: string | null
          year_of_passing: number | null
        }
        Insert: {
          alumni_name?: string | null
          contact_email?: string | null
          course?: string | null
          created_at?: string | null
          days_remaining?: never
          due_date?: string | null
          employee_review_result?: string | null
          employer_name?: string | null
          fee_amount?: number | null
          id?: string | null
          is_overdue?: never
          paid_at?: string | null
          request_number?: string | null
          request_type?: string | null
          status?: string | null
          year_of_passing?: number | null
        }
        Update: {
          alumni_name?: string | null
          contact_email?: string | null
          course?: string | null
          created_at?: string | null
          days_remaining?: never
          due_date?: string | null
          employee_review_result?: string | null
          employer_name?: string | null
          fee_amount?: number | null
          id?: string | null
          is_overdue?: never
          paid_at?: string | null
          request_number?: string | null
          request_type?: string | null
          status?: string | null
          year_of_passing?: number | null
        }
        Relationships: []
      }
      consultant_dashboard: {
        Row: {
          commission_paid: number | null
          commission_pending: number | null
          consultant_email: string | null
          consultant_id: string | null
          consultant_name: string | null
          consultant_phone: string | null
          conversions: number | null
          default_commission_type: string | null
          default_commission_value: number | null
          pipeline: number | null
          total_commission: number | null
          total_fee_collected: number | null
          total_leads: number | null
          user_id: string | null
        }
        Relationships: []
      }
      consultant_roi_summary: {
        Row: {
          admitted: number | null
          commission_type: string | null
          commission_value: number | null
          consultant_id: string | null
          consultant_name: string | null
          consultant_phone: string | null
          conversion_pct: number | null
          total_leads: number | null
        }
        Relationships: []
      }
      counsellor_feedback_summary: {
        Row: {
          avg_rating: number | null
          counsellor_id: string | null
          counsellor_name: string | null
          five_star: number | null
          four_star: number | null
          low_rating: number | null
          pending: number | null
          total_responses: number | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      counsellor_leaderboard: {
        Row: {
          counsellor_id: string | null
          counsellor_name: string | null
          daily_score: number | null
          monthly_score: number | null
          negative_actions: number | null
          positive_actions: number | null
          total_score: number | null
          user_id: string | null
          weekly_score: number | null
        }
        Relationships: []
      }
      counsellor_performance_stats: {
        Row: {
          conversions: number | null
          counsellor_id: string | null
          counsellor_name: string | null
          followups_completed: number | null
          followups_overdue: number | null
          leads_assigned: number | null
          total_calls: number | null
          total_whatsapps: number | null
          user_id: string | null
          visits_scheduled: number | null
        }
        Relationships: []
      }
      counsellor_tat_defaults: {
        Row: {
          app_checkins_overdue: number | null
          counsellor_name: string | null
          counsellor_phone: string | null
          new_leads_overdue: number | null
          overdue_followups: number | null
          profile_id: string | null
          total_defaults: number | null
          user_id: string | null
        }
        Relationships: []
      }
      course_first_year_fee: {
        Row: {
          code: string | null
          commission_amount: number | null
          course_id: string | null
          first_year_fee: number | null
          name: string | null
        }
        Insert: {
          code?: string | null
          commission_amount?: number | null
          course_id?: string | null
          first_year_fee?: never
          name?: string | null
        }
        Update: {
          code?: string | null
          commission_amount?: number | null
          course_id?: string | null
          first_year_fee?: never
          name?: string | null
        }
        Relationships: []
      }
      course_marketing_info: {
        Row: {
          apply_url: string | null
          campus_id: string | null
          campus_name: string | null
          course_code: string | null
          course_id: string | null
          course_name: string | null
          course_summary: string | null
          cover_image_url: string | null
          description: string | null
          duration_years: number | null
          eligibility: string | null
          google_maps_url: string | null
          video_url_en: string | null
          video_url_hi: string | null
        }
        Relationships: []
      }
      daily_admission_trend: {
        Row: {
          admissions: number | null
          day: string | null
          new_leads: number | null
        }
        Relationships: []
      }
      followup_sla_breached: {
        Row: {
          counsellor_id: string | null
          counsellor_user_id: string | null
          followup_id: string | null
          hours_overdue: number | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          lead_stage: Database["public"]["Enums"]["lead_stage"] | null
          scheduled_at: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      hourly_activity_heatmap: {
        Row: {
          activity_count: number | null
          day_of_week: number | null
          hour: number | null
        }
        Relationships: []
      }
      inactive_leads: {
        Row: {
          counsellor_id: string | null
          id: string | null
          inactive_days: number | null
          last_activity: string | null
          max_inactive_days: number | null
          name: string | null
          phone: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      lead_payment_summary: {
        Row: {
          application_fee_paid: number | null
          campus_id: string | null
          course_id: string | null
          lead_id: string | null
          name: string | null
          offer_amount: number | null
          phone: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          token_amount: number | null
          token_balance: number | null
          token_fee_paid: number | null
          total_paid: number | null
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
            foreignKeyName: "leads_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      overdue_followups: {
        Row: {
          counsellor_id: string | null
          counsellor_user_id: string | null
          days_overdue: number | null
          id: string | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          lead_stage: Database["public"]["Enums"]["lead_stage"] | null
          notes: string | null
          scheduled_at: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      pending_approvals: {
        Row: {
          created_at: string | null
          detail_type: string | null
          detail_value: number | null
          id: string | null
          kind: string | null
          pending_role: string | null
          reason: string | null
          requested_by_id: string | null
          status: string | null
          subject_id: string | null
          subject_name: string | null
        }
        Relationships: []
      }
      post_visit_pending_followups: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          counsellor_id: string | null
          course_id: string | null
          days_since_visit: number | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          lead_source: Database["public"]["Enums"]["lead_source"] | null
          lead_stage: Database["public"]["Enums"]["lead_stage"] | null
          visit_completed_at: string | null
          visit_date: string | null
          visit_id: string | null
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
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      post_visit_pipeline: {
        Row: {
          avg_days_pending: number | null
          counsellor_id: string | null
          counsellor_name: string | null
          followed_up_7d: number | null
          pending_total: number | null
          visited_7d: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      seat_matrix: {
        Row: {
          admitted: number | null
          available: number | null
          campus_id: string | null
          campus_name: string | null
          course_code: string | null
          course_id: string | null
          course_name: string | null
          department_id: string | null
          department_name: string | null
          institution_type: string | null
          pipeline_leads: number | null
          total_seats: number | null
        }
        Relationships: [
          {
            foreignKeyName: "institutions_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "institutions_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
        ]
      }
      sla_breached_leads: {
        Row: {
          assigned_at: string | null
          counsellor_id: string | null
          hours_since_assigned: number | null
          id: string | null
          name: string | null
          phone: string | null
          sla_hours: number | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      sla_warning_leads: {
        Row: {
          assigned_at: string | null
          campus_id: string | null
          counsellor_id: string | null
          course_id: string | null
          first_contact_hours: number | null
          hours_remaining: number | null
          hours_since_assigned: number | null
          id: string | null
          name: string | null
          phone: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          warning_hours: number | null
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
            foreignKeyName: "leads_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      source_funnel: {
        Row: {
          admitted: number | null
          applied: number | null
          contacted: number | null
          interviewed: number | null
          offered: number | null
          source: string | null
          token_paid: number | null
          total: number | null
          visited: number | null
        }
        Relationships: []
      }
      source_roi_summary: {
        Row: {
          ad_spend: number | null
          admitted: number | null
          applied: number | null
          conversion_pct: number | null
          cost_per_admission: number | null
          month: string | null
          source: string | null
          total_leads: number | null
        }
        Relationships: []
      }
      stage_aging_summary: {
        Row: {
          avg_days_in_stage: number | null
          lead_count: number | null
          max_days_in_stage: number | null
          stage: string | null
          stale_count: number | null
        }
        Relationships: []
      }
      team_leader_defaults_summary: {
        Row: {
          app_checkins_overdue: number | null
          counsellor_name: string | null
          counsellor_profile_id: string | null
          leader_name: string | null
          leader_phone: string | null
          leader_profile_id: string | null
          leader_user_id: string | null
          new_leads_overdue: number | null
          overdue_followups: number | null
          team_id: string | null
          team_name: string | null
          total_defaults: number | null
        }
        Relationships: []
      }
      unassigned_leads_bucket: {
        Row: {
          bucket: string | null
          campus_id: string | null
          campus_name: string | null
          course_id: string | null
          course_name: string | null
          created_at: string | null
          email: string | null
          id: string | null
          lead_score: number | null
          lead_temperature: string | null
          name: string | null
          phone: string | null
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
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
            foreignKeyName: "leads_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_first_year_fee"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "seat_matrix"
            referencedColumns: ["course_id"]
          },
        ]
      }
      visits_needing_confirmation: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          counsellor_id: string | null
          google_maps_url: string | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          scheduled_by: string | null
          status: string | null
          urgency: string | null
          visit_date: string | null
          visit_id: string | null
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
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      visits_needing_followup: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          counsellor_id: string | null
          days_since_visit: number | null
          google_maps_url: string | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          scheduled_by: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          visit_date: string | null
          visit_id: string | null
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
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      visits_unclosed_today: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          counsellor_id: string | null
          counsellor_name: string | null
          counsellor_user_id: string | null
          lead_id: string | null
          lead_name: string | null
          lead_phone: string | null
          status: string | null
          visit_date: string | null
          visit_id: string | null
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
            foreignKeyName: "campus_visits_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "course_marketing_info"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          assigned_to: string | null
          counsellor_id: string | null
          last_direction: string | null
          last_message: string | null
          last_message_at: string | null
          lead_id: string | null
          lead_name: string | null
          lead_stage: string | null
          phone: string | null
          unread_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_leaderboard"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_performance_stats"
            referencedColumns: ["counsellor_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "counsellor_tat_defaults"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_leader_defaults_summary"
            referencedColumns: ["counsellor_profile_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "inactive_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_payment_summary"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_breached_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sla_warning_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unassigned_leads_bucket"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_to_waitlist: {
        Args: { p_campus_id: string; p_course_id: string; p_lead_id: string }
        Returns: number
      }
      can_view_lead: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
      claim_leads: {
        Args: { _assign_to: string; _lead_ids: string[] }
        Returns: {
          assigned_count: number
          failed_count: number
        }[]
      }
      compute_lead_score: { Args: { p_lead_id: string }; Returns: number }
      compute_lead_temperature: { Args: { p_score: number }; Returns: string }
      compute_myp_grade: {
        Args: {
          _academic_year: string
          _criterion_total: number
          _subject_group_id: string
        }
        Returns: number
      }
      count_pending_approvals: { Args: never; Returns: number }
      find_lead_duplicates: {
        Args: {
          p_email?: string
          p_lead_id: string
          p_limit?: number
          p_name?: string
          p_phone?: string
        }
        Returns: {
          created_at: string
          email: string
          id: string
          match_reasons: string[]
          match_score: number
          name: string
          phone: string
          source: string
          stage: string
        }[]
      }
      find_name_duplicates: {
        Args: { p_exclude_id?: string; p_name: string; p_threshold?: number }
        Returns: {
          id: string
          name: string
          phone: string
          similarity: number
          stage: string
        }[]
      }
      find_phone_duplicates: {
        Args: { p_exclude_id?: string; p_phone: string }
        Returns: {
          counsellor_id: string
          created_at: string
          id: string
          name: string
          phone: string
          stage: string
        }[]
      }
      fn_cleanup_stale_ai_calls: { Args: never; Returns: undefined }
      fn_next_business_hour: {
        Args: { p_delay_minutes?: number }
        Returns: string
      }
      fn_process_ai_call_queue: { Args: never; Returns: undefined }
      get_consultant_commission: {
        Args: { _consultant_id: string; _course_id: string }
        Returns: {
          annual_fee: number
          commission_amount: number
        }[]
      }
      get_leads_for_counsellor_assignment: {
        Args: never
        Returns: {
          campus_id: string
          lead_id: string
        }[]
      }
      get_unassigned_leads_bucket: {
        Args: never
        Returns: {
          bucket: string
          campus_id: string
          campus_name: string
          course_id: string
          course_name: string
          created_at: string
          email: string
          id: string
          institution_code: string
          lead_score: number
          lead_temperature: string
          name: string
          phone: string
          source: string
          stage: string
        }[]
      }
      get_user_auth_info: {
        Args: never
        Returns: {
          auth_created_at: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      get_user_permissions: { Args: { _user_id: string }; Returns: string[] }
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
      insert_lead: {
        Args: {
          _campus_id?: string
          _counsellor_id?: string
          _course_id?: string
          _email?: string
          _guardian_name?: string
          _guardian_phone?: string
          _name: string
          _notes?: string
          _phone: string
          _source?: string
        }
        Returns: string
      }
      promote_from_waitlist: {
        Args: { p_campus_id?: string; p_course_id: string }
        Returns: string
      }
      request_application_edit_access: {
        Args: {
          _application_id: string
          _duration_hours?: number
          _reason: string
          _sections?: string[]
        }
        Returns: string
      }
      review_application_edit_request: {
        Args: { _decision: string; _notes?: string; _request_id: string }
        Returns: Json
      }
      revoke_application_edit_unlock: {
        Args: { _application_id: string }
        Returns: undefined
      }
      staff_update_application: {
        Args: { _application_id: string; _section: string; _updates: Json }
        Returns: Json
      }
      upsert_application_lead: {
        Args: {
          _application_id?: string
          _campus_id?: string
          _course_id?: string
          _email?: string
          _name: string
          _phone: string
          _source?: string
        }
        Returns: string
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
        | "consultant"
        | "ib_coordinator"
        | "office_admin"
        | "publisher"
      ib_programme: "pyp" | "myp"
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
        | "collegedunia"
        | "collegehai"
        | "mirai_website"
        | "salahlo"
      lead_stage:
        | "new_lead"
        | "application_in_progress"
        | "application_submitted"
        | "application_fee_paid"
        | "ai_called"
        | "counsellor_call"
        | "visit_scheduled"
        | "interview"
        | "offer_sent"
        | "token_paid"
        | "pre_admitted"
        | "admitted"
        | "waitlisted"
        | "rejected"
        | "not_interested"
        | "ineligible"
        | "dnc"
        | "deferred"
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
        "consultant",
        "ib_coordinator",
        "office_admin",
        "publisher",
      ],
      ib_programme: ["pyp", "myp"],
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
        "collegedunia",
        "collegehai",
        "mirai_website",
        "salahlo",
      ],
      lead_stage: [
        "new_lead",
        "application_in_progress",
        "application_submitted",
        "application_fee_paid",
        "ai_called",
        "counsellor_call",
        "visit_scheduled",
        "interview",
        "offer_sent",
        "token_paid",
        "pre_admitted",
        "admitted",
        "waitlisted",
        "rejected",
        "not_interested",
        "ineligible",
        "dnc",
        "deferred",
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
