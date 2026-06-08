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

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: roleRow, error: roleErr } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) throw new Error(roleErr.message);
  if (!roleRow) throw new Error("Forbidden: admin role required");
}

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
    await assertAdmin(context);

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
  for (let page = 1; page <= 50; page++) {
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
    await assertAdmin(context);

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

/* ============================================================
   DIRECTORY READ — profiles + primary team + auth last-seen,
   merged server-side. Paginated everywhere to dodge the 1000-row cap.
   ============================================================ */
export type DirectoryRow = {
  id: string;
  nickname: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  referral_name: string | null;
  status: string;
  created_at: string;
  onboarded_at: string | null;
  last_sign_in_at: string | null;
  primary_team_nickname: string | null;
};

export const listUsersForAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DirectoryRow[]> => {
    await assertAdmin(context);

    const PAGE = 1000;

    // 1) All profiles (paginated)
    type P = Omit<DirectoryRow, "last_sign_in_at" | "primary_team_nickname">;
    const profiles: P[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, nickname, email, first_name, last_name, phone, referral_name, status, created_at, onboarded_at",
        )
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      profiles.push(...(data as P[]));
      if (data.length < PAGE) break;
    }

    // 2) Primary team nickname per owner (paginated)
    const primaryByUser = new Map<string, string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("teams")
        .select("owner_user_id, nickname, is_primary")
        .eq("is_primary", true)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const t of data as Array<{ owner_user_id: string; nickname: string }>) {
        if (t.owner_user_id) primaryByUser.set(t.owner_user_id, t.nickname);
      }
      if (data.length < PAGE) break;
    }

    // 3) Auth last-seen (paginated; perPage kept well under any GoTrue cap)
    const lastSeen = new Map<string, string | null>();
    const perPage = 200;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      for (const u of data.users) lastSeen.set(u.id, u.last_sign_in_at ?? null);
      if (data.users.length < perPage) break;
    }

    return profiles.map((p) => ({
      ...p,
      last_sign_in_at: lastSeen.get(p.id) ?? null,
      primary_team_nickname: primaryByUser.get(p.id) ?? null,
    }));
  });

/* ============================================================
   WELCOME / FIRST-LOGIN — issue a set-password (recovery) email.
   Provisioned accounts already exist with no password, so the link
   type is recovery (invite rejects existing users). The user lands
   on /welcome with a recovery session and sets a password there.

   This sends via Supabase's configured SMTP. Configure CUSTOM SMTP
   in the Supabase dashboard before a bulk send, or the built-in
   limiter will throttle most emails. Also add your /welcome URL to
   Auth > URL Configuration > Redirect URLs.
   ============================================================ */
export const sendWelcomeEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(500),
        redirectTo: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    // Resolve emails in id chunks (avoids huge .in() lists)
    const emailById = new Map<string, string>();
    const ids = [...data.userIds];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: rows, error } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) if (r.email) emailById.set(r.id, r.email);
    }

    const results: Array<{ id: string; email?: string; ok: boolean; error?: string }> = [];
    for (const id of data.userIds) {
      const email = emailById.get(id);
      if (!email) {
        results.push({ id, ok: false, error: "No email on profile" });
        continue;
      }
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: data.redirectTo,
      });
      results.push(error ? { id, email, ok: false, error: error.message } : { id, email, ok: true });
      // Gentle throttle so a large blast doesn't hammer the SMTP provider.
      await new Promise((r) => setTimeout(r, 150));
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;

    await supabaseAdmin.from("admin_audit").insert({
      actor_id: context.userId,
      action: "user.welcome_sent",
      detail: { requested: data.userIds.length, sent, failed },
    });

    return { sent, failed, results };
  });

/* ============================================================
   ONBOARDING — stamp profiles.onboarded_at for the caller.
   Uses the admin client to bypass any RLS on the column.
   ============================================================ */
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
