import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

interface SendInput {
  tournamentId: string
  teamId: string
}

interface TestInput {
  tournamentId: string
  teamId?: string
  teamNickname?: string
  recipientEmail: string
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

// Format an ISO date-only string (YYYY-MM-DD) as DD/MM/YYYY without TZ drift.
function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

// Format a TZ timestamp as "DD/MM/YYYY, HH:mm" in Europe/London.
function fmtDeadlineUK(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')}, ${get('hour')}:${get('minute')}`
}

type SupaClient = Awaited<ReturnType<typeof getCtx>>['supabase']

// Builds the templateData payload + idempotency key + recipient.
async function buildPicksConfirmationPayload(
  supabase: SupaClient,
  args: { tournamentId: string; teamId: string; firstNameUserId?: string | null },
) {
  const [tournamentRes, picksRes, teamRes, profileRes] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, name, location, start_date, end_date, submission_deadline')
      .eq('id', args.tournamentId)
      .maybeSingle(),
    supabase
      .from('picks')
      .select('bucket, golfer_id, last_edited_at, tweak_count')
      .eq('tournament_id', args.tournamentId)
      .eq('team_id', args.teamId)
      .order('bucket'),
    supabase.from('teams').select('id, nickname, owner_user_id').eq('id', args.teamId).maybeSingle(),
    args.firstNameUserId
      ? supabase
          .from('profiles')
          .select('id, first_name, email')
          .eq('id', args.firstNameUserId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ])

  const tournament = tournamentRes.data as any
  const picks = (picksRes.data ?? []) as any[]
  const team = teamRes.data as any

  if (!tournament) return { ok: false as const, reason: 'no_tournament' as const }
  if (!team) return { ok: false as const, reason: 'no_team' as const }
  if (!picks.length) return { ok: false as const, reason: 'no_picks' as const }

  const golferIds = Array.from(new Set(picks.map((p) => p.golfer_id).filter(Boolean))) as string[]
  const golferNames = new Map<string, string>()
  if (golferIds.length) {
    const { data: golfers } = await supabase
      .from('golfers')
      .select('id, golfer_name')
      .in('id', golferIds)
    for (const g of (golfers ?? []) as any[]) golferNames.set(g.id, g.golfer_name)
  }

  const pickRows = picks
    .map((p) => ({ bucket: p.bucket as number, golfer: golferNames.get(p.golfer_id) ?? 'Unknown' }))
    .sort((a, b) => a.bucket - b.bucket)

  const tweakCount = picks.reduce((m, p) => Math.max(m, p.tweak_count ?? 0), 0)
  const maxEdited = picks.reduce((m, p) => {
    const t = p.last_edited_at ? new Date(p.last_edited_at).getTime() : 0
    return t > m ? t : m
  }, 0)
  const maxEditedIso = maxEdited ? new Date(maxEdited).toISOString() : 'unknown'

  const year = String(tournament.start_date ?? '').slice(0, 4)

  // Resolve owner email + first name if caller didn't pre-fetch.
  let ownerEmail: string | null = null
  let firstName: string | null = profileRes.data?.first_name ?? null
  if (profileRes.data?.email) {
    ownerEmail = profileRes.data.email
  } else if (team?.owner_user_id) {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('first_name, email')
      .eq('id', team.owner_user_id)
      .maybeSingle()
    ownerEmail = (ownerProfile as any)?.email ?? null
    if (!firstName) firstName = (ownerProfile as any)?.first_name ?? null
  }

  const origin = await resolveOrigin()
  const tournamentUrl = `${origin}/tournament/${tournament.id}`

  const templateData = {
    firstName: firstName ?? undefined,
    tournamentName: tournament.name as string,
    year,
    location: tournament.location as string,
    startDate: fmtDateOnly(tournament.start_date),
    endDate: fmtDateOnly(tournament.end_date),
    deadline: fmtDeadlineUK(tournament.submission_deadline),
    teamNickname: team.nickname as string,
    picks: pickRows,
    tournamentUrl,
    tweakCount,
  }

  const idempotencyKey = `picks-confirmation-${args.teamId}-${args.tournamentId}-${maxEditedIso}`

  return { ok: true as const, templateData, idempotencyKey, ownerEmail, origin }
}

async function resolveOrigin(): Promise<string> {
  try {
    const { getRequest, getRequestHost } = await import('@tanstack/react-start/server')
    // Prefer the actual request URL so dev (http://localhost) works.
    try {
      const req = getRequest()
      if (req?.url) {
        const u = new URL(req.url)
        return `${u.protocol}//${u.host}`
      }
    } catch {
      // fall through
    }
    const host = getRequestHost()
    if (host) {
      const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
      return `${proto}://${host}`
    }
  } catch {
    // ignore
  }
  return 'https://www.major7s.com'
}

async function postSend(args: {
  origin: string
  recipientEmail: string
  idempotencyKey: string
  templateData: Record<string, any>
}) {
  const { getRequestHeader } = await import('@tanstack/react-start/server')
  const auth = getRequestHeader('authorization') ?? ''
  const res = await fetch(`${args.origin}/lovable/email/transactional/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({
      templateName: 'picks-confirmation',
      recipientEmail: args.recipientEmail,
      idempotencyKey: args.idempotencyKey,
      templateData: args.templateData,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('picks-confirmation send failed', { status: res.status, body })
    return { ok: false as const, status: res.status, body }
  }
  return { ok: true as const }
}

// Helper to get context shape for typing in builder.
function getCtx() {
  return null as unknown as { supabase: any; userId: string }
}

/**
 * Server fn called from the lineup save flow.
 * Pulls tournament + picks + team + profile, sends picks-confirmation through
 * the shared transactional send route (unsubscribe token is minted there).
 * Idempotency key is stable per (team, tournament, latest edit time).
 */
export const sendPicksConfirmation = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SendInput) => {
    if (!input?.tournamentId || typeof input.tournamentId !== 'string') {
      throw new Error('tournamentId required')
    }
    if (!input?.teamId || typeof input.teamId !== 'string') {
      throw new Error('teamId required')
    }
    return { tournamentId: input.tournamentId, teamId: input.teamId }
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any
    const built = await buildPicksConfirmationPayload(supabase, {
      tournamentId: data.tournamentId,
      teamId: data.teamId,
      firstNameUserId: userId,
    })
    if (!built.ok) return { ok: false as const, reason: built.reason }
    if (!built.ownerEmail) return { ok: false, reason: 'no_email' as const }

    const sent = await postSend({
      origin: built.origin,
      recipientEmail: built.ownerEmail,
      idempotencyKey: built.idempotencyKey,
      templateData: built.templateData,
    })
    return sent.ok ? { ok: true as const } : { ok: false as const, reason: 'send_failed' as const }
  })

/**
 * Admin-only diagnostic: render + send a real picks-confirmation using
 * existing tournament/team data to an arbitrary recipient email.
 *
 * Call from an authenticated admin context:
 *   const send = useServerFn(sendPicksConfirmationTest)
 *   await send({ data: { tournamentId, teamNickname, recipientEmail } })
 *
 * Returns the built templateData + idempotencyKey so you can verify every
 * variable is sourced correctly.
 */
export const sendPicksConfirmationTest = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TestInput) => {
    if (!input?.tournamentId || typeof input.tournamentId !== 'string') {
      throw new Error('tournamentId required')
    }
    if (!input?.recipientEmail || typeof input.recipientEmail !== 'string') {
      throw new Error('recipientEmail required')
    }
    if (!input.teamId && !input.teamNickname) {
      throw new Error('teamId or teamNickname required')
    }
    return {
      tournamentId: input.tournamentId,
      teamId: input.teamId?.trim() || undefined,
      teamNickname: input.teamNickname?.trim() || undefined,
      recipientEmail: input.recipientEmail.trim(),
    }
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any

    const { data: isAdmin, error: roleErr } = await supabase.rpc('has_role', {
      _user_id: userId,
      _role: 'admin',
    })
    if (roleErr) throw new Error(`role check failed: ${roleErr.message}`)
    if (!isAdmin) throw new Error('Forbidden: admin only')

    let teamId = data.teamId
    if (!teamId) {
      const { data: teams, error } = await supabase
        .from('teams')
        .select('id, nickname')
        .ilike('nickname', data.teamNickname!)
      if (error) throw new Error(`team lookup failed: ${error.message}`)
      if (!teams?.length) throw new Error(`no team found with nickname "${data.teamNickname}"`)
      if (teams.length > 1) {
        throw new Error(
          `ambiguous team nickname "${data.teamNickname}" - matches ${teams.length} teams; pass teamId instead`,
        )
      }
      teamId = (teams[0] as any).id as string
    }

    const built = await buildPicksConfirmationPayload(supabase, {
      tournamentId: data.tournamentId,
      teamId: teamId!,
      firstNameUserId: null,
    })
    if (!built.ok) {
      return { ok: false as const, reason: built.reason, teamId }
    }

    const sent = await postSend({
      origin: built.origin,
      recipientEmail: data.recipientEmail!,
      idempotencyKey: `${built.idempotencyKey}-test-${Date.now()}`,
      templateData: built.templateData,
    })

    return {
      ok: sent.ok,
      recipientEmail: data.recipientEmail,
      teamId,
      idempotencyKey: built.idempotencyKey,
      templateData: built.templateData,
      sendStatus: sent.ok ? 200 : sent.status,
      sendBody: sent.ok ? null : sent.body,
    }
  })
