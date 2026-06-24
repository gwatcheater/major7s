import { createFileRoute } from '@tanstack/react-router'

/**
 * Pick-deadline reminder cron.
 *
 * Triggered by pg_cron every 30 minutes. For each tournament whose
 * submission_deadline falls between (now + 2h45m) and (now + 3h15m), find every
 * approved user who has no picks for that tournament and send the
 * pick-reminder email. The tight 30-min window guarantees we fire roughly
 * once per user per tournament (cron runs every 30 min so the window slides past).
 *
 * Auth: requires Supabase anon key in the `apikey` header (standard cron auth).
 */
export const Route = createFileRoute('/api/public/hooks/pick-reminder')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Lightweight auth: require the project's anon key. The `/api/public/*`
        // prefix bypasses the framework auth gate, so we enforce a shared key here.
        const apiKey = request.headers.get('apikey')
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY
        if (!apiKey || !expected || apiKey !== expected) {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

        // Window: deadline in 2h45m..3h15m from now.
        const nowMs = Date.now()
        const windowStart = new Date(nowMs + 2 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString()
        const windowEnd = new Date(nowMs + 3 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString()

        const { data: tournaments, error: tErr } = await supabaseAdmin
          .from('tournaments')
          .select('id, name, submission_deadline')
          .gte('submission_deadline', windowStart)
          .lte('submission_deadline', windowEnd)
        if (tErr) {
          console.error('pick-reminder: tournaments query failed', tErr)
          return Response.json({ error: 'tournaments query failed' }, { status: 500 })
        }
        if (!tournaments?.length) {
          return Response.json({ ok: true, tournaments: 0, sent: 0 })
        }

        const React = await import('react')
        const { render } = await import('@react-email/components')
        const { TEMPLATES } = await import('@/lib/email-templates/registry')
        const tpl = TEMPLATES['pick-reminder']
        if (!tpl) return Response.json({ error: 'template missing' }, { status: 500 })

        const reqUrl = new URL(request.url)
        const origin = `${reqUrl.protocol}//${reqUrl.host}`

        // Pre-fetch all approved profiles once.
        const { data: profiles, error: pErr } = await supabaseAdmin
          .from('profiles')
          .select('id, email, first_name, nickname, status')
          .eq('status', 'approved')
        if (pErr) {
          console.error('pick-reminder: profiles query failed', pErr)
          return Response.json({ error: 'profiles query failed' }, { status: 500 })
        }
        const approvedProfiles = (profiles ?? []).filter((p: any) => p.email)

        let sentCount = 0
        const errors: Array<{ tournament: string; error: string }> = []

        for (const t of tournaments) {
          // Find teams that already have at least one pick for this tournament.
          const { data: pickedRows, error: pickErr } = await supabaseAdmin
            .from('picks')
            .select('team_id')
            .eq('tournament_id', (t as any).id)
          if (pickErr) {
            errors.push({ tournament: (t as any).id, error: pickErr.message })
            continue
          }
          const pickedTeamIds = new Set(((pickedRows ?? []) as any[]).map((r) => r.team_id))

          // Map approved profiles -> their primary team.
          const { data: teams, error: teamsErr } = await supabaseAdmin
            .from('teams')
            .select('id, owner_user_id, is_primary')
            .eq('is_primary', true)
          if (teamsErr) {
            errors.push({ tournament: (t as any).id, error: teamsErr.message })
            continue
          }
          const ownerToTeam = new Map<string, string>()
          for (const team of teams ?? []) {
            ownerToTeam.set((team as any).owner_user_id, (team as any).id)
          }

          const deadlineStr = (t as any).submission_deadline
            ? new Date((t as any).submission_deadline).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
              })
            : undefined

          const subject =
            typeof tpl.subject === 'function'
              ? tpl.subject({ tournamentName: (t as any).name })
              : tpl.subject

          for (const profile of approvedProfiles) {
            const teamId = ownerToTeam.get((profile as any).id)
            if (!teamId) continue
            if (pickedTeamIds.has(teamId)) continue

            const recipient = (profile as any).email as string

            // Suppression check
            const { data: suppressed } = await supabaseAdmin
              .from('suppressed_emails')
              .select('id')
              .eq('email', recipient.toLowerCase())
              .maybeSingle()
            if (suppressed) continue

            const templateData = {
              firstName: (profile as any).first_name || (profile as any).nickname,
              tournamentName: (t as any).name,
              deadline: deadlineStr,
              tournamentUrl: `${origin}/tournament/${(t as any).id}`,
            }

            const element = React.createElement(tpl.component, templateData)
            const html = await render(element)
            const text = await render(element, { plainText: true })
            const messageId = crypto.randomUUID()

            // Mint or reuse unsubscribe token — required by the email API
            // for purpose:'transactional'. Mirror /lovable/email/transactional/send.
            const normalizedEmail = recipient.toLowerCase()
            let unsubscribeToken: string
            const { data: existingToken } = await supabaseAdmin
              .from('email_unsubscribe_tokens')
              .select('token, used_at')
              .eq('email', normalizedEmail)
              .maybeSingle()
            if (existingToken && !(existingToken as any).used_at) {
              unsubscribeToken = (existingToken as any).token
            } else {
              const bytes = new Uint8Array(32)
              crypto.getRandomValues(bytes)
              const newToken = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
              await supabaseAdmin
                .from('email_unsubscribe_tokens')
                .upsert(
                  { token: newToken, email: normalizedEmail },
                  { onConflict: 'email', ignoreDuplicates: true },
                )
              const { data: stored } = await supabaseAdmin
                .from('email_unsubscribe_tokens')
                .select('token')
                .eq('email', normalizedEmail)
                .maybeSingle()
              unsubscribeToken = (stored as any)?.token ?? newToken
            }

            await supabaseAdmin.from('email_send_log').insert({
              message_id: messageId,
              template_name: 'pick-reminder',
              recipient_email: recipient,
              status: 'pending',
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
                label: 'pick-reminder',
                idempotency_key: `pick-reminder-${(t as any).id}-${(profile as any).id}`,
                unsubscribe_token: unsubscribeToken,
                queued_at: new Date().toISOString(),
              },
            })
            if (enqErr) {
              await supabaseAdmin.from('email_send_log').insert({
                message_id: messageId,
                template_name: 'pick-reminder',
                recipient_email: recipient,
                status: 'failed',
                error_message: enqErr.message,
              })
              errors.push({ tournament: (t as any).id, error: enqErr.message })
              continue
            }
            sentCount++
          }
        }

        return Response.json({
          ok: true,
          tournaments: tournaments.length,
          sent: sentCount,
          errors,
        })
      },
    },
  },
})
