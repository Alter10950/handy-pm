/**
 * Hand-written to match supabase/migrations/*.sql exactly, in the same
 * shape `supabase gen types typescript` produces. Once the project is
 * linked, regenerate for real with:
 *
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
 *
 * and diff against this file — it should be a near-exact match.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          org_id: string | null;
          full_name: string | null;
          role: ProfileRole;
          created_at: string;
        };
        Insert: {
          id: string;
          org_id?: string | null;
          full_name?: string | null;
          role?: ProfileRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          full_name?: string | null;
          role?: ProfileRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          site_address: string | null;
          status: ProjectStatus;
          deadline: string | null;
          planned_days: number | null;
          mark_drawing_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          site_address?: string | null;
          status?: ProjectStatus;
          deadline?: string | null;
          planned_days?: number | null;
          mark_drawing_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          site_address?: string | null;
          status?: ProjectStatus;
          deadline?: string | null;
          planned_days?: number | null;
          mark_drawing_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_mark_drawing_id_fkey";
            columns: ["mark_drawing_id"];
            isOneToOne: false;
            referencedRelation: "drawings";
            referencedColumns: ["id"];
          },
        ];
      };
      crews: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          size: number;
          cost_per_hour: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          size?: number;
          cost_per_hour?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          size?: number;
          cost_per_hour?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crews_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_members: {
        Row: {
          id: string;
          crew_id: string;
          name: string;
        };
        Insert: {
          id?: string;
          crew_id: string;
          name: string;
        };
        Update: {
          id?: string;
          crew_id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      drawings: {
        Row: {
          id: string;
          project_id: string;
          page_index: number;
          storage_path: string;
          width: number | null;
          height: number | null;
          role: DrawingRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          page_index?: number;
          storage_path: string;
          width?: number | null;
          height?: number | null;
          role?: DrawingRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          page_index?: number;
          storage_path?: string;
          width?: number | null;
          height?: number | null;
          role?: DrawingRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drawings_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      packing_slips: {
        Row: {
          id: string;
          project_id: string;
          storage_path: string;
          uploaded_at: string;
          parsed: Json | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          storage_path: string;
          uploaded_at?: string;
          parsed?: Json | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          storage_path?: string;
          uploaded_at?: string;
          parsed?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "packing_slips_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          size: string | null;
          unit: string;
          total_needed: number;
          received: number;
          labor_units: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          size?: string | null;
          unit?: string;
          total_needed?: number;
          received?: number;
          labor_units?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          size?: string | null;
          unit?: string;
          total_needed?: number;
          received?: number;
          labor_units?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "materials_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      phases: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          color: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          color: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          color?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "phases_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      rows: {
        Row: {
          id: string;
          project_id: string;
          drawing_id: string;
          phase_id: string | null;
          label: string;
          x: number;
          y: number;
          w: number;
          h: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          drawing_id: string;
          phase_id?: string | null;
          label: string;
          x: number;
          y: number;
          w: number;
          h: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          drawing_id?: string;
          phase_id?: string | null;
          label?: string;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rows_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rows_drawing_id_fkey";
            columns: ["drawing_id"];
            isOneToOne: false;
            referencedRelation: "drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rows_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "phases";
            referencedColumns: ["id"];
          },
        ];
      };
      row_materials: {
        Row: {
          id: string;
          row_id: string;
          material_id: string;
          required_qty: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          row_id: string;
          material_id: string;
          required_qty?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          row_id?: string;
          material_id?: string;
          required_qty?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "row_materials_row_id_fkey";
            columns: ["row_id"];
            isOneToOne: false;
            referencedRelation: "rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "row_materials_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
        ];
      };
      installs: {
        Row: {
          id: string;
          row_id: string;
          material_id: string;
          qty: number;
          installed_on: string;
          crew_id: string | null;
          note: string | null;
          idempotency_key: string | null;
          device_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          row_id: string;
          material_id: string;
          qty: number;
          installed_on?: string;
          crew_id?: string | null;
          note?: string | null;
          idempotency_key?: string | null;
          device_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          row_id?: string;
          material_id?: string;
          qty?: number;
          installed_on?: string;
          crew_id?: string | null;
          note?: string | null;
          idempotency_key?: string | null;
          device_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "installs_row_id_fkey";
            columns: ["row_id"];
            isOneToOne: false;
            referencedRelation: "rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "installs_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "installs_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      blockers: {
        Row: {
          id: string;
          project_id: string;
          row_id: string | null;
          crew_id: string | null;
          code: BlockerCode;
          note: string | null;
          photo_path: string | null;
          work_date: string;
          resolved_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          row_id?: string | null;
          crew_id?: string | null;
          code: BlockerCode;
          note?: string | null;
          photo_path?: string | null;
          work_date?: string;
          resolved_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          row_id?: string | null;
          crew_id?: string | null;
          code?: BlockerCode;
          note?: string | null;
          photo_path?: string | null;
          work_date?: string;
          resolved_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blockers_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blockers_row_id_fkey";
            columns: ["row_id"];
            isOneToOne: false;
            referencedRelation: "rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blockers_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      day_logs: {
        Row: {
          id: string;
          project_id: string;
          crew_id: string | null;
          work_date: string;
          arrived_at: string | null;
          offload_start: string | null;
          offload_end: string | null;
          install_start: string | null;
          install_end: string | null;
          departed_at: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          crew_id?: string | null;
          work_date?: string;
          arrived_at?: string | null;
          offload_start?: string | null;
          offload_end?: string | null;
          install_start?: string | null;
          install_end?: string | null;
          departed_at?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          crew_id?: string | null;
          work_date?: string;
          arrived_at?: string | null;
          offload_start?: string | null;
          offload_end?: string | null;
          install_start?: string | null;
          install_end?: string | null;
          departed_at?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "day_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "day_logs_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      assignments: {
        Row: {
          id: string;
          project_id: string;
          crew_id: string | null;
          row_id: string | null;
          work_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          crew_id?: string | null;
          row_id?: string | null;
          work_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          crew_id?: string | null;
          row_id?: string | null;
          work_date?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_row_id_fkey";
            columns: ["row_id"];
            isOneToOne: false;
            referencedRelation: "rows";
            referencedColumns: ["id"];
          },
        ];
      };
      targets: {
        Row: {
          id: string;
          project_id: string;
          crew_id: string | null;
          work_date: string;
          material_id: string | null;
          target_qty: number;
        };
        Insert: {
          id?: string;
          project_id: string;
          crew_id?: string | null;
          work_date: string;
          material_id?: string | null;
          target_qty?: number;
        };
        Update: {
          id?: string;
          project_id?: string;
          crew_id?: string | null;
          work_date?: string;
          material_id?: string | null;
          target_qty?: number;
        };
        Relationships: [
          {
            foreignKeyName: "targets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "targets_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "targets_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
        ];
      };
      project_schedule: {
        Row: {
          id: string;
          project_id: string;
          work_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          work_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          work_date?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_schedule_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_rates: {
        Row: {
          id: string;
          crew_id: string;
          task_key: string;
          units_per_hour: number | null;
          samples: number;
        };
        Insert: {
          id?: string;
          crew_id: string;
          task_key: string;
          units_per_hour?: number | null;
          samples?: number;
        };
        Update: {
          id?: string;
          crew_id?: string;
          task_key?: string;
          units_per_hour?: number | null;
          samples?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crew_rates_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      share_tokens: {
        Row: {
          id: string;
          project_id: string;
          token: string;
          scope: string;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          token?: string;
          scope?: string;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          token?: string;
          scope?: string;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "share_tokens_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      row_progress: {
        Row: {
          row_id: string;
          project_id: string;
          drawing_id: string;
          label: string;
          x: number;
          y: number;
          w: number;
          h: number;
          required_total: number;
          installed_total: number;
          pct: number;
          has_materials: boolean;
          is_complete: boolean;
          phase_id: string | null;
          created_at: string;
        };
        Relationships: [];
      };
      project_progress: {
        Row: {
          project_id: string;
          org_id: string;
          name: string;
          site_address: string | null;
          status: ProjectStatus;
          deadline: string | null;
          created_at: string;
          row_count: number;
          rows_complete: number;
          rows_missing_materials: number;
          required_total: number;
          installed_total: number;
          pct: number;
        };
        Relationships: [];
      };
      material_reconciliation: {
        Row: {
          material_id: string;
          project_id: string;
          name: string;
          unit: string;
          needed: number;
          received: number;
          assigned: number;
          installed: number;
          left_qty: number;
          to_order: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_org_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      org_id_of_project: {
        Args: { p_project_id: string };
        Returns: string | null;
      };
      org_id_of_crew: {
        Args: { p_crew_id: string };
        Returns: string | null;
      };
      org_id_of_row: {
        Args: { p_row_id: string };
        Returns: string | null;
      };
      set_marking_drawing: {
        Args: { p_project_id: string; p_drawing_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Views<T extends keyof PublicSchema["Views"]> =
  PublicSchema["Views"][T]["Row"];
