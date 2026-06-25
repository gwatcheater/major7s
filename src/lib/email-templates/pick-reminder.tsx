import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  firstName?: string
  tournamentName?: string
  /**
   * Raw submission_deadline (ISO timestamp). Formatted in-template to UK time,
   * e.g. "16 Jul @ 06:00 BST". If a non-ISO string is passed it is shown as-is.
   */
  deadline?: string
  tournamentUrl?: string
}

/**
 * Format an ISO deadline to "{day} {mon} @ {HH:mm} {TZ}" in Europe/London,
 * deriving the BST/GMT label automatically. Falls back to the raw string if
 * the value isn't a parseable date.
 */
function formatDeadlineUK(value?: string): string | null {
  if (!value?.trim()) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return value.trim()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} @ ${get('hour')}:${get('minute')} ${get('timeZoneName')}`
}

const PickReminderEmail = ({ firstName, tournamentName, deadline, tournamentUrl }: Props) => {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = tournamentName?.trim() || 'the next tournament'
  const url = tournamentUrl?.trim() || 'https://www.major7s.com'
  const deadlineDisplay = formatDeadlineUK(deadline)
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Deadline approaching.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Picks Close Soon</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              Heads up - picks for <strong>{name}</strong> close in about 3 hours and we
              don't have a lineup from you yet.
            </Text>
            {deadlineDisplay ? (
              <Text style={meta}>Picks close {deadlineDisplay}</Text>
            ) : null}
            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                Make Your Picks
              </Button>
            </Section>
            <Hr style={hr} />
            <Text style={footer}>
              Already submitted? You can ignore this - there's a slight delay between
              picks landing and reminders going out.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PickReminderEmail,
  subject: (d: Record<string, any>) =>
    `Picks close soon for ${d.tournamentName || 'the next tournament'}`,
  displayName: 'Pick deadline reminder',
  previewData: {
    firstName: 'Rob',
    tournamentName: 'The Open Championship',
    deadline: '2026-07-16T05:00:00Z',
    tournamentUrl: 'https://www.major7s.com',
  },
} satisfies TemplateEntry

export default PickReminderEmail

const FOREST = '#103D2E'
const GOLD = '#C9A227'
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '24px 0' }
const container = { backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '560px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }
const header = { backgroundColor: FOREST, padding: '24px 28px' }
const headerHeading = { color: '#ffffff', fontSize: '20px', lineHeight: '1.3', fontWeight: 'bold' as const, margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const contentSection = { padding: '28px' }
const text = { fontSize: '15px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px' }
const meta = { fontSize: '13px', color: '#6b7280', margin: '4px 0 16px' }
const buttonWrap = { textAlign: 'center' as const, margin: '8px 0 4px' }
const button = { backgroundColor: GOLD, color: FOREST, fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '6px', padding: '14px 28px', textDecoration: 'none', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#6b7280', lineHeight: '1.5', margin: 0 }
