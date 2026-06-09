import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WELCOME_URL = "https://major7s.com/welcome";

const RECOVERY_SUBJECT = "You're in — set up your Major7s account";

const RECOVERY_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec;margin:0;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e3d8;">

        <tr>
          <td style="background:#103D2E;padding:28px 32px;">
            <div style="color:#C9A227;font-size:13px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;">Major7s</div>
            <div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:6px;">Major7s.com Is Live. Tweaked, Upgraded.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:32px;color:#1f2a24;font-size:16px;line-height:1.6;">
            <p style="margin:0 0 16px;">{{ if .Data.first_name }}Hi {{ .Data.first_name }},{{ else }}Hi there,{{ end }}</p>

            <p style="margin:0 0 16px;">
              Major7s has moved to a brand-new home.
            </p>

            <p style="margin:0 0 16px;">
              Your account is already set up. We've pre-loaded your details and your full picks history, so everything from previous years is waiting for you - nothing to re-enter.
            </p>

            <p style="margin:0 0 24px;">
              There's one thing left to do: set a password and you're ready to play.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td align="center" style="border-radius:8px;background:#C9A227;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;color:#103D2E;font-size:16px;font-weight:bold;text-decoration:none;border-radius:8px;">
                    Set your password
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;color:#6b7770;font-size:14px;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="{{ .ConfirmationURL }}" style="color:#103D2E;word-break:break-all;">{{ .ConfirmationURL }}</a>
            </p>

            <p style="margin:24px 0 0;color:#6b7770;font-size:14px;">
              You're receiving this because you have previously played Major7s. If you weren't expecting it, you can safely ignore this email - no account changes will be made until you set a password.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#f4f2ec;padding:20px 32px;color:#9aa39c;font-size:12px;text-align:center;">
            Major7s · The majors picks league
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`;

export const runAuthConfigMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Admin gate
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin role required");

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const endpoint = `${url}/auth/v1/admin/config`;
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    // 1) Read current config to preserve existing redirect allowlist
    const getRes = await fetch(endpoint, { headers });
    if (!getRes.ok) {
      const text = await getRes.text();
      throw new Error(`Failed to read auth config (${getRes.status}): ${text}`);
    }
    const current = (await getRes.json()) as Record<string, unknown>;
    const existingRaw = (current.uri_allow_list as string | undefined) ?? "";
    const existing = existingRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const already = existing.includes(WELCOME_URL);
    const merged = already ? existing : [...existing, WELCOME_URL];
    const mergedCsv = merged.join(",");

    // 2) PATCH allowlist + recovery email template
    const patchBody = {
      uri_allow_list: mergedCsv,
      mailer_subjects_recovery: RECOVERY_SUBJECT,
      mailer_templates_recovery_content: RECOVERY_HTML,
    };

    const patchRes = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error(`Failed to update auth config (${patchRes.status}): ${text}`);
    }

    // Audit
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_audit").insert({
      actor_id: context.userId,
      action: "auth.config_migration",
      detail: {
        welcome_url: WELCOME_URL,
        allow_list_before: existing,
        allow_list_after: merged,
        allow_list_added: !already,
        recovery_template_updated: true,
      },
    });

    return {
      ok: true,
      allowListAdded: !already,
      allowListAfter: merged,
      templateUpdated: true,
    };
  });
