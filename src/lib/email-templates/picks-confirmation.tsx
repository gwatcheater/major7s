import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Button,
  Row,
  Column,
  Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface PickRow {
  bucket: number
  golfer: string
}
interface Props {
  firstName?: string
  tournamentName?: string
  picks?: PickRow[]
  isUpdate?: boolean
  tournamentUrl?: string
  deadline?: string
  tweakCount?: number
}

const PicksConfirmationEmail = ({
  firstName,
  tournamentName,
  picks,
  isUpdate,
  tournamentUrl,
  deadline,
  tweakCount,
}: Props) => {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = tournamentName?.trim() || 'the tournament'
  const url = tournamentUrl?.trim() || 'https://www.major7s.com'
  const action = isUpdate ? 'updated' : 'locked in'
  const rows = picks ?? []
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Your ${name} picks are ${isUpdate ? 'updated' : 'in'}.`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>
              {isUpdate ? 'Picks Updated' : 'Picks Confirmed'}
            </Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              You've {action} your lineup for <strong>{name}</strong>. Here's what we have on
              file:
            </Text>

            <Section style={pickTable}>
              {rows.map((p) => (
                <Row key={p.bucket} style={pickRow}>
                  <Column style={bucketCol}>Tier {p.bucket}</Column>
                  <Column style={golferCol}>{p.golfer}</Column>
                </Row>
              ))}
            </Section>

            {typeof tweakCount === 'number' && tweakCount > 0 ? (
              <Text style={meta}>Tweaks used: {tweakCount}</Text>
            ) : null}
            {deadline?.trim() ? (
              <Text style={meta}>Picks lock: {deadline}</Text>
            ) : null}

            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                View Tournament
              </Button>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              You can still tweak your picks until the deadline. Good luck.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PicksConfirmationEmail,
  subject: (d: Record<string, any>) =>
    `${d.isUpdate ? 'Picks updated' : 'Picks confirmed'} — ${d.tournamentName || 'Major7s'}`,
  displayName: 'Picks confirmation',
  previewData: {
    firstName: 'Rob',
    tournamentName: 'The Masters',
    isUpdate: false,
    tweakCount: 0,
    deadline: 'Thu, Apr 10 · 7:00 AM ET',
    tournamentUrl: 'https://www.major7s.com',
    picks: [
      { bucket: 1, golfer: 'Scottie Scheffler' },
      { bucket: 2, golfer: 'Rory McIlroy' },
      { bucket: 3, golfer: 'Xander Schauffele' },
      { bucket: 4, golfer: 'Ludvig Aberg' },
    ],
  },
} satisfies TemplateEntry

export default PicksConfirmationEmail

const FOREST = '#103D2E'
const GOLD = '#C9A227'
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '24px 0' }
const container = { backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '560px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }
const header = { backgroundColor: FOREST, padding: '24px 28px' }
const headerHeading = { color: '#ffffff', fontSize: '20px', lineHeight: '1.3', fontWeight: 'bold' as const, margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const contentSection = { padding: '28px' }
const text = { fontSize: '15px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px' }
const meta = { fontSize: '13px', color: '#6b7280', margin: '4px 0' }
const pickTable = { border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', margin: '12px 0 20px' }
const pickRow = { borderBottom: '1px solid #e5e7eb' }
const bucketCol = { width: '90px', padding: '10px 14px', fontSize: '13px', color: FOREST, fontWeight: 'bold' as const, backgroundColor: '#f9fafb' }
const golferCol = { padding: '10px 14px', fontSize: '14px', color: '#1f2937' }
const buttonWrap = { textAlign: 'center' as const, margin: '8px 0 4px' }
const button = { backgroundColor: GOLD, color: FOREST, fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '6px', padding: '14px 28px', textDecoration: 'none', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#6b7280', lineHeight: '1.5', margin: 0 }
