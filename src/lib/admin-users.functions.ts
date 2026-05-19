import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RowSchema = z.object({
  email: z.string().email().max(255),
  first_name: z.string().trim().max(100).optional().default(""),
  last_name: z.string().trim().max(100).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  team_nickname: z.string().trim().max(100).optional().default(""),
  referral_name: z.string().trim().max(100).optional().default(""),
});

export const bulkCreateApprovedUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(RowSchema).min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Require admin
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin role required");

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];

    for (const row of data.rows) {
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: row.email,
          email_confirm: true,
          user_metadata: {
            first_name: row.first_name,
            last_name: row.last_name,
            phone: row.phone,
            team_nickname: row.team_nickname,
            referral_name: row.referral_name,
          },
        });

      if (createErr || !created?.user) {
        results.push({ email: row.email, ok: false, error: createErr?.message ?? "Unknown" });
        continue;
      }

      // Trigger creates profile (status=pending). Force approved.
      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", created.user.id);

      if (upErr) {
        results.push({ email: row.email, ok: false, error: `Created but approve failed: ${upErr.message}` });
        continue;
      }
      results.push({ email: row.email, ok: true });
    }

    const succeeded = results.filter((r) => r.ok).length;
    return { succeeded, failed: results.length - succeeded, results };
  });
