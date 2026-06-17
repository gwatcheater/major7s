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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: string
          target_user: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          target_user?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          target_user?: string | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          image_url: string | null
          title: string
          tournament_id: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          title: string
          tournament_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          title?: string
          tournament_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      golfers: {
        Row: {
          bucket_number: number
          created_at: string
          golfer_name: string
          id: string
          owgr_rank: number | null
          tournament_id: string
          updated_at: string
        }
        Insert: {
          bucket_number: number
          created_at?: string
          golfer_name: string
          id?: string
          owgr_rank?: number | null
          tournament_id: string
          updated_at?: string
        }
        Update: {
          bucket_number?: number
          created_at?: string
          golfer_name?: string
          id?: string
          owgr_rank?: number | null
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "golfers_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          bucket: number
          golfer_id: string
          id: string
          last_edited_at: string
          submitted_at: string
          team_id: string
          tournament_id: string
          tweak_count: number
        }
        Insert: {
          bucket: number
          golfer_id: string
          id?: string
          last_edited_at?: string
          submitted_at?: string
          team_id: string
          tournament_id: string
          tweak_count?: number
        }
        Update: {
          bucket?: number
          golfer_id?: string
          id?: string
          last_edited_at?: string
          submitted_at?: string
          team_id?: string
          tournament_id?: string
          tweak_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "picks_golfer_id_fkey"
            columns: ["golfer_id"]
            isOneToOne: false
            referencedRelation: "golfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      picks_helper: {
        Row: {
          espn_player_id: string
          golfer_name: string
          helper_info: string
          helper_name: string
        }
        Insert: {
          espn_player_id: string
          golfer_name: string
          helper_info: string
          helper_name: string
        }
        Update: {
          espn_player_id?: string
          golfer_name?: string
          helper_info?: string
          helper_name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          nickname: string
          onboarded_at: string | null
          phone: string | null
          referral_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          team_nickname: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          nickname: string
          onboarded_at?: string | null
          phone?: string | null
          referral_name?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          team_nickname?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          nickname?: string
          onboarded_at?: string | null
          phone?: string | null
          referral_name?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          team_nickname?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          nickname: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          nickname: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          nickname?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tournament_leaderboard: {
        Row: {
          country: string | null
          espn_display_name: string
          espn_player_id: string
          golfer_id: string | null
          id: string
          imported_at: string
          is_tie: boolean | null
          position_display: string | null
          position_numeric: number | null
          position_r1: number | null
          position_r2: number | null
          position_r3: number | null
          position_r4: number | null
          round_1: number | null
          round_2: number | null
          round_3: number | null
          round_4: number | null
          rounds_completed: number | null
          score_to_par: number | null
          status_short_detail: string | null
          status_type: string | null
          total_strokes: number | null
          tournament_id: string
          withdrew_after_round: number | null
        }
        Insert: {
          country?: string | null
          espn_display_name: string
          espn_player_id: string
          golfer_id?: string | null
          id?: string
          imported_at?: string
          is_tie?: boolean | null
          position_display?: string | null
          position_numeric?: number | null
          position_r1?: number | null
          position_r2?: number | null
          position_r3?: number | null
          position_r4?: number | null
          round_1?: number | null
          round_2?: number | null
          round_3?: number | null
          round_4?: number | null
          rounds_completed?: number | null
          score_to_par?: number | null
          status_short_detail?: string | null
          status_type?: string | null
          total_strokes?: number | null
          tournament_id: string
          withdrew_after_round?: number | null
        }
        Update: {
          country?: string | null
          espn_display_name?: string
          espn_player_id?: string
          golfer_id?: string | null
          id?: string
          imported_at?: string
          is_tie?: boolean | null
          position_display?: string | null
          position_numeric?: number | null
          position_r1?: number | null
          position_r2?: number | null
          position_r3?: number | null
          position_r4?: number | null
          round_1?: number | null
          round_2?: number | null
          round_3?: number | null
          round_4?: number | null
          rounds_completed?: number | null
          score_to_par?: number | null
          status_short_detail?: string | null
          status_type?: string | null
          total_strokes?: number | null
          tournament_id?: string
          withdrew_after_round?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_leaderboard_golfer_id_fkey"
            columns: ["golfer_id"]
            isOneToOne: false
            referencedRelation: "golfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_leaderboard_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_results: {
        Row: {
          calculated_at: string
          context: Json | null
          id: string
          position: number
          result_type: string
          team_id: string
          tournament_id: string
        }
        Insert: {
          calculated_at?: string
          context?: Json | null
          id?: string
          position: number
          result_type: string
          team_id: string
          tournament_id: string
        }
        Update: {
          calculated_at?: string
          context?: Json | null
          id?: string
          position?: number
          result_type?: string
          team_id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_results_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_score_picks: {
        Row: {
          bucket: number
          counted: boolean
          golfer_id: string | null
          golfer_name: string
          id: string
          points: number
          status_type: string | null
          tournament_score_id: string
        }
        Insert: {
          bucket: number
          counted?: boolean
          golfer_id?: string | null
          golfer_name: string
          id?: string
          points: number
          status_type?: string | null
          tournament_score_id: string
        }
        Update: {
          bucket?: number
          counted?: boolean
          golfer_id?: string | null
          golfer_name?: string
          id?: string
          points?: number
          status_type?: string | null
          tournament_score_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_score_picks_golfer_id_fkey"
            columns: ["golfer_id"]
            isOneToOne: false
            referencedRelation: "golfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_score_picks_tournament_score_id_fkey"
            columns: ["tournament_score_id"]
            isOneToOne: false
            referencedRelation: "tournament_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_scores: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          id: string
          position_display: string
          position_numeric: number
          team_id: string
          thru_cut: number
          total_points: number
          tournament_id: string
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          id?: string
          position_display: string
          position_numeric: number
          team_id: string
          thru_cut: number
          total_points: number
          tournament_id: string
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          id?: string
          position_display?: string
          position_numeric?: number
          team_id?: string
          thru_cut?: number
          total_points?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_scores_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          bucket_sizes: Json
          created_at: string
          end_date: string
          espn_event_id: string | null
          id: string
          location: string
          logo_url: string | null
          name: string
          recap_blog: string | null
          start_date: string
          status: Database["public"]["Enums"]["tournament_status"]
          submission_deadline: string
          updated_at: string
        }
        Insert: {
          bucket_sizes?: Json
          created_at?: string
          end_date: string
          espn_event_id?: string | null
          id?: string
          location: string
          logo_url?: string | null
          name: string
          recap_blog?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["tournament_status"]
          submission_deadline: string
          updated_at?: string
        }
        Update: {
          bucket_sizes?: Json
          created_at?: string
          end_date?: string
          espn_event_id?: string | null
          id?: string
          location?: string
          logo_url?: string | null
          name?: string
          recap_blog?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["tournament_status"]
          submission_deadline?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      audit_admin_pick_edit: {
        Args: { _after_lock: boolean; _target: string; _tournament: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_impersonation: {
        Args: { _event: string; _target: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      set_primary_team: { Args: { _team_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
      profile_status: "pending" | "approved" | "rejected" | "suspended"
      tournament_status:
        | "upcoming"
        | "open_for_picks"
        | "picks_closed"
        | "live"
        | "completed"
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
      app_role: ["admin", "user"],
      profile_status: ["pending", "approved", "rejected", "suspended"],
      tournament_status: [
        "upcoming",
        "open_for_picks",
        "picks_closed",
        "live",
        "completed",
      ],
    },
  },
} as const
