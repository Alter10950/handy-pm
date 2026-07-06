/**
 * Generated via `supabase gen types typescript`, then hand-adjusted in two
 * ways: (1) CHECK-constrained text columns get this codebase's own literal
 * union types in place of the generator's plain `string` (Postgres CHECK
 * constraints aren't reflected in the generated types at all — this is an
 * intentional, valid improvement, not a discrepancy from the real schema;
 * see ADR-010); (2) a `Views<T>` export is added back for compatibility —
 * the generator now folds views into the same `Tables<T>` helper and no
 * longer emits a separate one, but the whole codebase imports `Views`.
 * Regenerate with:
 *
 *   npx supabase gen types typescript --project-id <ref>
 *
 * then reapply both adjustments (diff against this file to see exactly
 * which lines they touch).
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ProfileRole = "owner" | "pm" | "scheduler" | "crew";
export type ProjectStatus = "active" | "on_hold" | "complete";
export type DrawingRole = "reference" | "marking";
export type BlockerCode =
  | "MISSING_MATERIAL"
  | "WRONG_MATERIAL"
  | "CUSTOMER_DELAY"
  | "AREA_BLOCKED"
  | "FLOOR_ISSUE"
  | "DRAWING_ISSUE"
  | "CREW_SHORT"
  | "EQUIPMENT_ISSUE"
  | "WEATHER_TRUCK"
  | "OTHER";
export type MaterialCondition = "new" | "used";
export type MaterialReceiptStatus =
  | "ordered"
  | "received"
  | "verified"
  | "staged"
  | "short"
  | "damaged"
  | "wrong";
export type RowReadinessStatus = "ready" | "partial" | "blocked" | "complete";

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
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
      assignments: {
        Row: {
          created_at: string
          crew_id: string | null
          id: string
          project_id: string
          row_id: string | null
          work_date: string
        }
        Insert: {
          created_at?: string
          crew_id?: string | null
          id?: string
          project_id: string
          row_id?: string | null
          work_date: string
        }
        Update: {
          created_at?: string
          crew_id?: string | null
          id?: string
          project_id?: string
          row_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "row_progress"
            referencedColumns: ["row_id"]
          },
          {
            foreignKeyName: "assignments_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "rows"
            referencedColumns: ["id"]
          },
        ]
      }
      blockers: {
        Row: {
          code: BlockerCode
          created_at: string
          created_by: string | null
          crew_id: string | null
          id: string
          note: string | null
          photo_path: string | null
          project_id: string
          resolved_at: string | null
          row_id: string | null
          work_date: string
        }
        Insert: {
          code: BlockerCode
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          project_id: string
          resolved_at?: string | null
          row_id?: string | null
          work_date?: string
        }
        Update: {
          code?: BlockerCode
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          project_id?: string
          resolved_at?: string | null
          row_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "blockers_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blockers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "blockers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blockers_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "row_progress"
            referencedColumns: ["row_id"]
          },
          {
            foreignKeyName: "blockers_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "rows"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          crew_id: string
          id: string
          name: string
        }
        Insert: {
          crew_id: string
          id?: string
          name: string
        }
        Update: {
          crew_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_rates: {
        Row: {
          crew_id: string
          id: string
          samples: number
          task_key: string
          units_per_hour: number | null
        }
        Insert: {
          crew_id: string
          id?: string
          samples?: number
          task_key: string
          units_per_hour?: number | null
        }
        Update: {
          crew_id?: string
          id?: string
          samples?: number
          task_key?: string
          units_per_hour?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_rates_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          cost_per_hour: number | null
          created_at: string
          id: string
          name: string
          org_id: string
          size: number
        }
        Insert: {
          cost_per_hour?: number | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          size?: number
        }
        Update: {
          cost_per_hour?: number | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          size?: number
        }
        Relationships: [
          {
            foreignKeyName: "crews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      day_logs: {
        Row: {
          arrived_at: string | null
          created_at: string
          created_by: string | null
          crew_id: string | null
          departed_at: string | null
          id: string
          install_end: string | null
          install_start: string | null
          note: string | null
          offload_end: string | null
          offload_start: string | null
          project_id: string
          work_date: string
        }
        Insert: {
          arrived_at?: string | null
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          departed_at?: string | null
          id?: string
          install_end?: string | null
          install_start?: string | null
          note?: string | null
          offload_end?: string | null
          offload_start?: string | null
          project_id: string
          work_date?: string
        }
        Update: {
          arrived_at?: string | null
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          departed_at?: string | null
          id?: string
          install_end?: string | null
          install_start?: string | null
          note?: string | null
          offload_end?: string | null
          offload_start?: string | null
          project_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_logs_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "day_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_versions: {
        Row: {
          approved_for_install: boolean
          created_at: string
          id: string
          page_index: number
          project_id: string
          storage_path: string
          superseded_at: string | null
          version: number
        }
        Insert: {
          approved_for_install?: boolean
          created_at?: string
          id?: string
          page_index: number
          project_id: string
          storage_path: string
          superseded_at?: string | null
          version: number
        }
        Update: {
          approved_for_install?: boolean
          created_at?: string
          id?: string
          page_index?: number
          project_id?: string
          storage_path?: string
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "drawing_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawings: {
        Row: {
          created_at: string
          height: number | null
          id: string
          page_index: number
          project_id: string
          role: DrawingRole
          storage_path: string
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          id?: string
          page_index?: number
          project_id: string
          role?: DrawingRole
          storage_path: string
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          id?: string
          page_index?: number
          project_id?: string
          role?: DrawingRole
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      installs: {
        Row: {
          created_at: string
          created_by: string | null
          crew_id: string | null
          device_id: string | null
          id: string
          idempotency_key: string | null
          installed_on: string
          material_id: string
          note: string | null
          qty: number
          row_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          installed_on?: string
          material_id: string
          note?: string | null
          qty: number
          row_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          installed_on?: string
          material_id?: string
          note?: string | null
          qty?: number
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installs_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "installs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installs_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "row_progress"
            referencedColumns: ["row_id"]
          },
          {
            foreignKeyName: "installs_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "rows"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_standards: {
        Row: {
          base_labor_units: number
          created_at: string
          id: string
          org_id: string
          task_key: string
          unit_basis: string
        }
        Insert: {
          base_labor_units: number
          created_at?: string
          id?: string
          org_id: string
          task_key: string
          unit_basis: string
        }
        Update: {
          base_labor_units?: number
          created_at?: string
          id?: string
          org_id?: string
          task_key?: string
          unit_basis?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_standards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      material_receipts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          material_id: string
          note: string | null
          qty: number
          status: MaterialReceiptStatus
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          material_id: string
          note?: string | null
          qty: number
          status: MaterialReceiptStatus
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          material_id?: string
          note?: string | null
          qty?: number
          status?: MaterialReceiptStatus
        }
        Relationships: [
          {
            foreignKeyName: "material_receipts_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "material_receipts_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          capacity: string | null
          compatible_system: string | null
          condition: MaterialCondition
          created_at: string
          id: string
          labor_units: number
          name: string
          profile: string | null
          project_id: string
          received: number
          size: string | null
          total_needed: number
          unit: string
        }
        Insert: {
          capacity?: string | null
          compatible_system?: string | null
          condition?: MaterialCondition
          created_at?: string
          id?: string
          labor_units?: number
          name: string
          profile?: string | null
          project_id: string
          received?: number
          size?: string | null
          total_needed?: number
          unit?: string
        }
        Update: {
          capacity?: string | null
          compatible_system?: string | null
          condition?: MaterialCondition
          created_at?: string
          id?: string
          labor_units?: number
          name?: string
          profile?: string | null
          project_id?: string
          received?: number
          size?: string | null
          total_needed?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "materials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          org_id: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          org_id: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          default_working_days: number[]
          id: string
          logo_path: string | null
          name: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          default_working_days?: number[]
          id?: string
          logo_path?: string | null
          name: string
        }
        Update: {
          address?: string | null
          created_at?: string
          default_working_days?: number[]
          id?: string
          logo_path?: string | null
          name?: string
        }
        Relationships: []
      }
      packing_slips: {
        Row: {
          id: string
          parsed: Json | null
          project_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          id?: string
          parsed?: Json | null
          project_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          id?: string
          parsed?: Json | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_slips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "packing_slips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          project_id: string
          sort_order: number
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          crew_id: string | null
          full_name: string | null
          id: string
          org_id: string | null
          role: ProfileRole
        }
        Insert: {
          created_at?: string
          crew_id?: string | null
          full_name?: string | null
          id: string
          org_id?: string | null
          role?: ProfileRole
        }
        Update: {
          created_at?: string
          crew_id?: string | null
          full_name?: string | null
          id?: string
          org_id?: string | null
          role?: ProfileRole
        }
        Relationships: [
          {
            foreignKeyName: "profiles_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_estimates: {
        Row: {
          assumptions: Json
          confidence: string | null
          created_at: string
          estimated_days: number
          estimated_hours: number
          estimated_labor_units: number
          forecast_finish: string | null
          id: string
          project_id: string
        }
        Insert: {
          assumptions?: Json
          confidence?: string | null
          created_at?: string
          estimated_days: number
          estimated_hours: number
          estimated_labor_units: number
          forecast_finish?: string | null
          id?: string
          project_id: string
        }
        Update: {
          assumptions?: Json
          confidence?: string | null
          created_at?: string
          estimated_days?: number
          estimated_hours?: number
          estimated_labor_units?: number
          forecast_finish?: string | null
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_schedule: {
        Row: {
          created_at: string
          id: string
          project_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          work_date: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_schedule_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_schedule_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          deadline: string | null
          id: string
          mark_drawing_id: string | null
          name: string
          org_id: string
          planned_days: number | null
          site_address: string | null
          status: ProjectStatus
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          id?: string
          mark_drawing_id?: string | null
          name: string
          org_id: string
          planned_days?: number | null
          site_address?: string | null
          status?: ProjectStatus
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          id?: string
          mark_drawing_id?: string | null
          name?: string
          org_id?: string
          planned_days?: number | null
          site_address?: string | null
          status?: ProjectStatus
        }
        Relationships: [
          {
            foreignKeyName: "projects_mark_drawing_id_fkey"
            columns: ["mark_drawing_id"]
            isOneToOne: false
            referencedRelation: "drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      row_materials: {
        Row: {
          created_at: string
          id: string
          material_id: string
          required_qty: number
          row_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          required_qty?: number
          row_id: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          required_qty?: number
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "row_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "row_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "row_materials_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "row_progress"
            referencedColumns: ["row_id"]
          },
          {
            foreignKeyName: "row_materials_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "rows"
            referencedColumns: ["id"]
          },
        ]
      }
      rows: {
        Row: {
          area_accessible: boolean
          created_at: string
          drawing_approved: boolean
          drawing_id: string
          h: number
          id: string
          label: string
          materials_ready: boolean
          phase_id: string | null
          project_id: string
          w: number
          x: number
          y: number
        }
        Insert: {
          area_accessible?: boolean
          created_at?: string
          drawing_approved?: boolean
          drawing_id: string
          h: number
          id?: string
          label: string
          materials_ready?: boolean
          phase_id?: string | null
          project_id: string
          w: number
          x: number
          y: number
        }
        Update: {
          area_accessible?: boolean
          created_at?: string
          drawing_approved?: boolean
          drawing_id?: string
          h?: number
          id?: string
          label?: string
          materials_ready?: boolean
          phase_id?: string | null
          project_id?: string
          w?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "rows_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rows_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      share_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          project_id: string
          scope: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          project_id: string
          scope?: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          project_id?: string
          scope?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "share_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          crew_id: string | null
          id: string
          material_id: string | null
          project_id: string
          target_qty: number
          work_date: string
        }
        Insert: {
          crew_id?: string | null
          id?: string
          material_id?: string | null
          project_id: string
          target_qty?: number
          work_date: string
        }
        Update: {
          crew_id?: string | null
          id?: string
          material_id?: string | null
          project_id?: string
          target_qty?: number
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "targets_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "targets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "targets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      material_reconciliation: {
        Row: {
          // Every column here is guaranteed non-null by the view's own SQL
          // (coalesce()'d aggregates, or a direct not-null base column) —
          // the generator marks all view columns nullable regardless,
          // since it can't prove that through arbitrary view SQL. Same
          // "intentional, valid improvement over the generator" reasoning
          // as ADR-010's literal-union treatment, applied to nullability.
          assigned: number
          installed: number
          left_qty: number
          material_id: string
          name: string
          needed: number
          project_id: string
          received: number
          to_order: number
          unit: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "materials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_progress: {
        Row: {
          created_at: string
          deadline: string | null
          installed_total: number
          name: string
          org_id: string
          pct: number
          project_id: string
          required_total: number
          row_count: number
          rows_complete: number
          rows_missing_materials: number
          site_address: string | null
          status: ProjectStatus
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      row_progress: {
        Row: {
          area_accessible: boolean
          created_at: string
          crew_assigned: boolean
          drawing_approved: boolean
          drawing_id: string
          h: number
          has_materials: boolean
          installed_total: number
          is_complete: boolean
          label: string
          materials_ready: boolean
          pct: number
          phase_id: string | null
          project_id: string
          readiness_status: RowReadinessStatus
          required_total: number
          row_id: string
          w: number
          x: number
          y: number
        }
        Relationships: [
          {
            foreignKeyName: "rows_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rows_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_org_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      org_id_of_crew: { Args: { p_crew_id: string }; Returns: string }
      org_id_of_material: { Args: { p_material_id: string }; Returns: string }
      org_id_of_project: { Args: { p_project_id: string }; Returns: string }
      org_id_of_row: { Args: { p_row_id: string }; Returns: string }
      set_marking_drawing: {
        Args: { p_drawing_id: string; p_project_id: string }
        Returns: undefined
      }
      update_own_full_name: {
        Args: { p_full_name: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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

// Compatibility alias: the generator now folds views into Tables<T>'s own
// union and no longer emits a separate Views<T> helper, but every query
// module in this codebase imports Views<"row_progress"> etc. Single-arg
// call sites (every one in this codebase) resolve identically through
// Tables<T> — this just keeps the old, simpler two-helper shape callers
// already use, rather than rewriting every Views<...> call site to Tables.
export type Views<T extends keyof DefaultSchema["Views"]> =
  DefaultSchema["Views"][T]["Row"];

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
