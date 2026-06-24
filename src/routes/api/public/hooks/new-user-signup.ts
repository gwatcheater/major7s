import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * Public action route fired from the client immediately after a successful
 * supabase.auth.signUp(). Looks up the freshly-created profile and sends a
 * notification email to the site admin (recipient is fixed in the template).
 *
 * Security:
 * - The recipient is hard-pinned in the template (`to:`), so a malicious caller
 *   cannot redirect this email.
 * - We dedupe by checking that no prior 'admin-new-user' send exists for this
 *   email in the last 24h.
 * - The user must exist in auth (we look them up by email via the service-role
 *   admin client) before we'll send.
 */
const BodySchema = z.object({ email: z.string().email() })

export const Route = createFileRoute('/api/public/hooks/new-user-signup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed
        try {
          parsed = BodySchema.parse(await request.json())
        } catch {
          return Response.json({ error: 'invalid body' }, { status: 400 })
        }
        const email = parsed.email.toLowerCase()

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

        // Confirm the auth user exists for this email.
        const { data: lookup, error: lookupErr } = await supabaseAdmin
          .from('profiles')
          .select('id, nickname, email, first_name, last_name, phone, referral_name, team_nickname, created_at')
          .eq('email', email)
          .maybeSingle()
        if (lookupErr) {
          console.error('admin-new-user lookup failed', lookupErr)
          return Response.json({ error: 'lookup failed' }, { status: 500 })
        }
        if (!lookup) {
          // No profile yet — silently accept; the trigger may still be running.
          return Response.json({ ok: false, reason: 'no_profile' })
        }

        // Dedupe — skip if we've already sent within the last 24h.
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: recent } = await supabaseAdmin
          .from('email_send_log')
          .select('id')
          .eq('template_name', 'admin-new-user')
          .eq('recipient_email', 'rob@rjparker.co.uk')
          .gte('created_at', since)
          .ilike('error_message', `%${email}%`)
          .limit(1)
          .maybeSingle()
        if (recent) {
          return Response.json({ ok: false, reason: 'duplicate' })
        }

        const fullName = [lookup.first_name, lookup.last_name]
          .filter(Boolean)
          .join(' ')
          .trim()
        const signedUpAt = lookup.created_at
          ? new Date(lookup.created_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })
          : undefined

        // Build absolute origin for internal call.
        const reqUrl = new URL(request.url)
        const origin = `${reqUrl.protocol}//${reqUrl.host}`

        // Mint a service-role auth token to call the protected send route.
        // We use the admin client to issue a magic-link-style admin user lookup,
        // but the send route just validates a JWT via supabase.auth.getUser.
        // Easiest path: bypass the send route and enqueue directly here using
        // the same logic. That avoids minting tokens.
        const React = await import('react')
        const { render } = await import('@react-email/components')
        const { TEMPLATES } = await import('@/lib/email-templates/registry')
        const tpl = TEMPLATES['admin-new-user']
        if (!tpl) return Response.json({ error: 'template missing' }, { status: 500 })

        const recipient = tpl.to!
        const templateData = {
          nickname: lookup.nickname,
          fullName: fullName || undefined,
          email: lookup.email,
          phone: lookup.phone,
          referralName: lookup.referral_name,
          teamNickname: lookup.team_nickname,
          signedUpAt,
          adminUrl: `${origin}/admin`,
        }

        const element = React.createElement(tpl.component, templateData)
        const html = await render(element)
        const text = await render(element, { plainText: true })
        const subject =
          typeof tpl.subject === 'function' ? tpl.subject(templateData) : tpl.subject
        const messageId = crypto.randomUUID()

        // Suppression check
        const normalizedRecipient = recipient.toLowerCase()
        const { data: suppressed } = await supabaseAdmin
          .from('suppressed_emails')
          .select('id')
          .eq('email', normalizedRecipient)
          .maybeSingle()
        if (suppressed) {
          await supabaseAdmin.from('email_send_log').insert({
            message_id: messageId,
            template_name: 'admin-new-user',
            recipient_email: recipient,
            status: 'suppressed',
          })
          return Response.json({ ok: false, reason: 'suppressed' })
        }

        // Resolve unsubscribe token for the recipient. The Lovable email API
        // rejects purpose:'transactional' sends without this. Mirror the
        // mint/reuse logic from /lovable/email/transactional/send.
        let unsubscribeToken: string
        const { data: existingToken } = await supabaseAdmin
          .from('email_unsubscribe_tokens')
          .select('token, used_at')
          .eq('email', normalizedRecipient)
          .maybeSingle()
        if (existingToken && !existingToken.used_at) {
          unsubscribeToken = existingToken.token
        } else {
          const bytes = new Uint8Array(32)
          crypto.getRandomValues(bytes)
          const newToken = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
          await supabaseAdmin
            .from('email_unsubscribe_tokens')
            .upsert(
              { token: newToken, email: normalizedRecipient },
              { onConflict: 'email', ignoreDuplicates: true }
            )
          const { data: stored } = await supabaseAdmin
            .from('email_unsubscribe_tokens')
            .select('token')
            .eq('email', normalizedRecipient)
            .maybeSingle()
          unsubscribeToken = stored?.token ?? newToken
        }

        // Tag the log row with the new user's email so dedupe lookup above works.
        await supabaseAdmin.from('email_send_log').insert({
          message_id: messageId,
          template_name: 'admin-new-user',
          recipient_email: recipient,
          status: 'pending',
          error_message: `for=${email}`,
        })

        const { error: enqErr } = await supabaseAdmin.rpc('enqueue_email', {
          queue_name: 'transactional_emails',
          payload: {
            message_id: messageId,
            to: recipient,
            from: 'major7s <noreply@www.major7s.com>',
            sender_domain: 'notify.www.major7s.com',
            subject,
            html,
            text,
            purpose: 'transactional',
            label: 'admin-new-user',
            // Stable per-user key so retries / trigger+client races dedupe at the provider.
            idempotency_key: `admin-new-user-${lookup.id}`,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
          },
        })
        if (enqErr) {
          console.error('admin-new-user enqueue failed', enqErr)
          await supabaseAdmin.from('email_send_log').insert({
            message_id: messageId,
            template_name: 'admin-new-user',
            recipient_email: recipient,
            status: 'failed',
            error_message: enqErr.message,
          })
          return Response.json({ error: 'enqueue failed' }, { status: 500 })
        }

        return Response.json({ ok: true })
      },
    },
  },
})
