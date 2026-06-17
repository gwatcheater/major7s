import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  firstName?: string
  tournamentName?: string
  deadline?: string
  tournamentUrl?: string
}

const PickReminderEmail = ({ firstName, tournamentName, deadline, tournamentUrl }: Props) => {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = tournamentName?.trim() || 'the next tournament'
  const url = tournamentUrl?.trim() || 'https://www.major7s.com'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Picks lock soon for ${name}.`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Picks Lock Soon</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              Heads up — picks for <strong>{name}</strong> lock in about 3 hours and we
              don't have a lineup from you yet.
            </Text>
            {deadline?.trim() ? (
              <Text style={meta}>Picks lock: {deadline}</Text>
            ) : null}
            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                Make Your Picks
              </Button>
            </Section>
            <Hr style={hr} />
            <Text style={footer}>
              Already submitted? You can ignore this — there's a slight delay between
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
    `Picks lock in 3 hours — ${d.tournamentName || 'Major7s'}`,
  displayName: 'Pick deadline reminder',
  previewData: {
    firstName: 'Rob',
    tournamentName: 'The Masters',
    deadline: 'Thu, Apr 10 · 7:00 AM ET',
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
