import * as React from 'react'
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface PickRow {
  bucket: number
  golfer: string
}

interface Props {
  firstName?: string
  tournamentName?: string
  year?: string | number
  location?: string
  startDate?: string
  endDate?: string
  deadline?: string
  teamNickname?: string
  picks?: PickRow[]
  tournamentUrl?: string
  tweakCount?: number
}

const FOREST = '#103D2E'
const GOLD = '#C9A227'

const PicksConfirmationEmail = ({
  firstName,
  tournamentName,
  year,
  location,
  startDate,
  endDate,
  deadline,
  teamNickname,
  picks,
  tournamentUrl,
  tweakCount,
}: Props) => {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const name = (tournamentName && tournamentName.trim()) || 'the tournament'
  const yr = year ? String(year) : ''
  const url = (tournamentUrl && tournamentUrl.trim()) || 'https://www.major7s.com'
  const team = (teamNickname && teamNickname.trim()) || 'Your team'
  const rows = picks ?? []
  const byBucket = new Map<number, string>()
  for (const r of rows) byBucket.set(r.bucket, r.golfer)
  const tweaks = typeof tweakCount === 'number' ? tweakCount : 0
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Picks confirmed - ${name}${yr ? ` ${yr}` : ''}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Picks Confirmed</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>

            <Text style={infoTitle}>
              <strong>{`${name}${yr ? ` ${yr}` : ''}`}</strong>
            </Text>
            {location ? <Text style={infoLine}>{location}</Text> : null}
            {startDate || endDate ? (
              <Text style={infoLine}>{`${startDate ?? ''} - ${endDate ?? ''}`}</Text>
            ) : null}
            <Text style={spacer}>&nbsp;</Text>
            <Text style={lockedIn}>
              <strong>Picks submitted. You're locked in!</strong>
            </Text>
            <Text style={spacer}>&nbsp;</Text>

            <Section style={pickTable}>
              <Row style={teamHeaderRow}>
                <Column colSpan={2} style={teamHeaderCol}>
                  {team}
                </Column>
              </Row>
              {[1, 2, 3, 4, 5, 6, 7].map((b) => (
                <Row key={b} style={pickRow}>
                  <Column style={bucketCol}>{`B${b}`}</Column>
                  <Column style={golferCol}>{byBucket.get(b) ?? '-'}</Column>
                </Row>
              ))}
            </Section>

            {deadline ? (
              <Text style={text}>{`Unlimited edits allowed until ${deadline}.`}</Text>
            ) : null}

            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                View Tournament
              </Button>
            </Section>

            <Text style={text}>Good luck.</Text>
            <Text style={meta}>{`Tweak count: ${tweaks}`}</Text>

            <Hr style={hr} />
            <Text style={footer}>
              <Link href="https://www.major7s.com" style={footerLink}>
                www.major7s.com
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PicksConfirmationEmail,
  subject: (d: Record<string, any>) => {
    const name = (d?.tournamentName as string) || 'Major7s'
    const yr = d?.year ? ` ${d.year}` : ''
    return `Picks confirmed - ${name}${yr}`
  },
  displayName: 'Picks confirmation',
  previewData: {
    firstName: 'Rob',
    tournamentName: 'The Masters',
    year: '2026',
    location: 'Augusta National Golf Club, Augusta, GA',
    startDate: '09/04/2026',
    endDate: '12/04/2026',
    deadline: '09/04/2026, 13:00',
    teamNickname: 'Birdie Bandits',
    tournamentUrl: 'https://www.major7s.com',
    tweakCount: 2,
    picks: [
      { bucket: 1, golfer: 'Scottie Scheffler' },
      { bucket: 2, golfer: 'Rory McIlroy' },
      { bucket: 3, golfer: 'Xander Schauffele' },
      { bucket: 4, golfer: 'Ludvig Aberg' },
      { bucket: 5, golfer: 'Jordan Spieth' },
      { bucket: 6, golfer: 'Justin Thomas' },
      { bucket: 7, golfer: 'Sahith Theegala' },
    ],
  },
} satisfies TemplateEntry

export default PicksConfirmationEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Arial, Helvetica, sans-serif',
  margin: 0,
  padding: '24px 0',
}
const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '560px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
}
const header = {
  backgroundColor: FOREST,
  padding: '24px 28px',
}
const headerHeading = {
  color: '#ffffff',
  fontSize: '20px',
  lineHeight: '1.3',
  fontWeight: 'bold' as const,
  margin: 0,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}
const contentSection = { padding: '28px' }
const text = { fontSize: '15px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px' }
const infoTitle = { fontSize: '16px', color: '#1f2937', lineHeight: '1.5', margin: '0 0 4px' }
const infoLine = { fontSize: '14px', color: '#1f2937', lineHeight: '1.5', margin: '0 0 4px' }
const lockedIn = { fontSize: '15px', color: FOREST, lineHeight: '1.6', margin: '0 0 4px' }
const spacer = { fontSize: '8px', lineHeight: '8px', margin: '8px 0' }
const meta = { fontSize: '13px', color: '#6b7280', margin: '4px 0 16px' }
const pickTable = {
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  overflow: 'hidden',
  margin: '12px 0 20px',
}
const teamHeaderRow = { backgroundColor: FOREST }
const teamHeaderCol = {
  padding: '12px 14px',
  fontSize: '14px',
  color: '#ffffff',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}
const pickRow = { borderBottom: '1px solid #e5e7eb' }
const bucketCol = {
  width: '70px',
  padding: '10px 14px',
  fontSize: '13px',
  color: FOREST,
  fontWeight: 'bold' as const,
  backgroundColor: '#f9fafb',
}
const golferCol = { padding: '10px 14px', fontSize: '14px', color: '#1f2937' }
const buttonWrap = { textAlign: 'center' as const, margin: '20px 0 20px' }
const button = {
  backgroundColor: GOLD,
  color: FOREST,
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '6px',
  padding: '14px 28px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  display: 'inline-block',
}
const hr = { borderColor: '#e5e7eb', margin: '20px 0' }
const footer = {
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '1.5',
  margin: '12px 0 0',
  textAlign: 'center' as const,
}
const footerLink = { color: FOREST, textDecoration: 'underline' }
