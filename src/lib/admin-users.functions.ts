import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RowSchema = z.object({
  email: z.string().email().max(255),
  first_name: z.string().trim().max(100).optional().default(""),
  last_name: z.string().trim().max(100).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  referral_name: z.string().trim().max(100).optional().default(""),
});

const ConflictMode = z.enum(["skip", "overwrite", "abort"]);

export const updateUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        newEmail: z.string().trim().email().max(255),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Admin role check
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin role required");

    const newEmail = data.newEmail.toLowerCase();

    // Read current email for audit + no-op detection
    const { data: existing, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (getErr || !existing?.user) {
      throw new Error(getErr?.message ?? "User not found");
    }
    const fromEmail = existing.user.email ?? null;
    if (fromEmail && fromEmail.toLowerCase() === newEmail) {
      return { ok: true, from: fromEmail, to: newEmail, unchanged: true };
    }

    // Update auth (source of truth)
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.userId,
      { email: newEmail, email_confirm: true },
    );
    if (updErr) {
      const m = updErr.message?.toLowerCase() ?? "";
      if (
        m.includes("already registered") ||
        m.includes("already been registered") ||
        m.includes("already exists") ||
        m.includes("duplicate")
      ) {
        throw new Error("That email is already in use by another account");
      }
      throw new Error(updErr.message);
    }

    // Mirror to profiles
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ email: newEmail })
      .eq("id", data.userId);

    // Audit log
    await supabaseAdmin.from("admin_audit").insert({
      actor_id: context.userId,
      action: "profile.email_change",
      target_user: data.userId,
      detail: { from: fromEmail, to: newEmail },
    });

    if (pErr) {
      return {
        ok: true,
        from: fromEmail,
        to: newEmail,
        profileMirrorError: pErr.message,
      };
    }
    return { ok: true, from: fromEmail, to: newEmail };
  });

type RowResult = {
  email: string;
  ok: boolean;
  action?: "created" | "skipped" | "overwritten";
  error?: string;
};

function isDuplicateError(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("already registered") ||
    m.includes("already been registered") ||
    m.includes("already exists") ||
    m.includes("duplicate")
  );
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  // Paginate up to a few pages to find the matching email
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

export const bulkCreateApprovedUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rows: z.array(RowSchema).min(1).max(500),
        conflictMode: ConflictMode.optional().default("skip"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin role required");

    const results: RowResult[] = [];
    let aborted = false;

    for (const row of data.rows) {
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: row.email,
          email_confirm: true,
          user_metadata: {
            first_name: row.first_name,
            last_name: row.last_name,
            phone: row.phone,
            referral_name: row.referral_name,
          },
        });

      if (createErr || !created?.user) {
        const dup = isDuplicateError(createErr?.message);
        if (dup) {
          if (data.conflictMode === "abort") {
            results.push({ email: row.email, ok: false, error: "Aborted on duplicate" });
            aborted = true;
            break;
          }
          if (data.conflictMode === "skip") {
            results.push({ email: row.email, ok: false, action: "skipped", error: "Already exists — skipped" });
            continue;
          }
          // overwrite
          const existingId = await findUserIdByEmail(row.email);
          if (!existingId) {
            results.push({ email: row.email, ok: false, error: "Exists but lookup failed" });
            continue;
          }
          const { error: upErr } = await supabaseAdmin
            .from("profiles")
            .update({
              first_name: row.first_name || null,
              last_name: row.last_name || null,
              phone: row.phone || null,
              referral_name: row.referral_name || null,
              status: "approved",
            })
            .eq("id", existingId);
          if (upErr) {
            results.push({ email: row.email, ok: false, error: `Overwrite failed: ${upErr.message}` });
            continue;
          }
          results.push({ email: row.email, ok: true, action: "overwritten" });
          continue;
        }
        results.push({ email: row.email, ok: false, error: createErr?.message ?? "Unknown" });
        continue;
      }

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", created.user.id);

      if (upErr) {
        results.push({ email: row.email, ok: false, error: `Created but approve failed: ${upErr.message}` });
        continue;
      }
      results.push({ email: row.email, ok: true, action: "created" });
    }

    const created = results.filter((r) => r.action === "created").length;
    const overwritten = results.filter((r) => r.action === "overwritten").length;
    const skipped = results.filter((r) => r.action === "skipped").length;
    const succeeded = created + overwritten;
    const failed = results.filter((r) => !r.ok && r.action !== "skipped").length;
    return { succeeded, failed, created, overwritten, skipped, aborted, results };
  });
