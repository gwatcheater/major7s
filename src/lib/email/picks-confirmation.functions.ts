import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

interface Input {
  tournamentId: string
  teamId: string
  isUpdate?: boolean
  tweakCount?: number
}

/**
 * Server fn called from the lineup save flow.
 * Fetches user email, tournament, golfer names, then enqueues the picks-confirmation
 * email. Fire-and-forget on the client; errors are logged but never surface to the user.
 */
export const sendPicksConfirmation = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    if (!input?.tournamentId || typeof input.tournamentId !== 'string') {
      throw new Error('tournamentId required')
    }
    if (!input?.teamId || typeof input.teamId !== 'string') {
      throw new Error('teamId required')
    }
    return {
      tournamentId: input.tournamentId,
      teamId: input.teamId,
      isUpdate: !!input.isUpdate,
      tweakCount: typeof input.tweakCount === 'number' ? input.tweakCount : 0,
    }
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context

    const [profileRes, tournamentRes, picksRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('email, first_name, nickname')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('tournaments')
        .select('id, name, submission_deadline')
        .eq('id', data.tournamentId)
        .maybeSingle(),
      supabase
        .from('picks')
        .select('bucket, golfer_id')
        .eq('tournament_id', data.tournamentId)
        .eq('team_id', data.teamId)
        .order('bucket'),
    ])

    const profile = profileRes.data
    const tournament = tournamentRes.data
    const picks = picksRes.data ?? []

    if (!profile?.email) return { ok: false, reason: 'no_email' as const }
    if (!tournament) return { ok: false, reason: 'no_tournament' as const }
    if (!picks.length) return { ok: false, reason: 'no_picks' as const }

    const golferIds = Array.from(
      new Set(picks.map((p: any) => p.golfer_id).filter(Boolean)),
    ) as string[]
    let golferNames = new Map<string, string>()
    if (golferIds.length) {
      const { data: golfers } = await supabase
        .from('golfers')
        .select('id, name')
        .in('id', golferIds)
      for (const g of golfers ?? []) golferNames.set((g as any).id, (g as any).name)
    }

    const pickRows = picks.map((p: any) => ({
      bucket: p.bucket,
      golfer: golferNames.get(p.golfer_id) ?? 'Unknown',
    }))

    const deadline = tournament.submission_deadline
      ? new Date(tournament.submission_deadline).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : undefined

    // Build absolute URL for the tournament page using the request origin.
    const { getRequestHost } = await import('@tanstack/react-start/server')
    let origin = 'https://www.major7s.com'
    try {
      const host = getRequestHost()
      if (host) origin = `https://${host}`
    } catch {
      // ignore — fall back to default
    }
    const tournamentUrl = `${origin}/tournament/${tournament.id}`

    // Call the shared transactional send route internally, forwarding the user's
    // bearer token so it passes auth.
    const { getRequestHeader } = await import('@tanstack/react-start/server')
    const auth = getRequestHeader('authorization') ?? ''

    const res = await fetch(`${origin}/lovable/email/transactional/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        templateName: 'picks-confirmation',
        recipientEmail: profile.email,
        idempotencyKey: `picks-confirm-${data.tournamentId}-${data.teamId}-${Date.now()}`,
        templateData: {
          firstName: profile.first_name || profile.nickname,
          tournamentName: tournament.name,
          isUpdate: data.isUpdate,
          tweakCount: data.tweakCount,
          deadline,
          tournamentUrl,
          picks: pickRows,
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('picks-confirmation send failed', { status: res.status, body })
      return { ok: false, reason: 'send_failed' as const }
    }
    return { ok: true as const }
  })
