import * as React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Row, Column, Hr, Link,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  nickname?: string
  fullName?: string
  email?: string
  phone?: string
  referralName?: string
  teamNickname?: string
  signedUpAt?: string
  adminUrl?: string
}

const AdminNewUserEmail = ({
  nickname, fullName, email, phone, referralName, teamNickname, signedUpAt, adminUrl,
}: Props) => {
  const url = adminUrl?.trim() || 'https://www.major7s.com/admin'
  const rows: Array<[string, string | undefined]> = [
    ['Nickname', nickname],
    ['Full name', fullName],
    ['Email', email],
    ['Phone', phone],
    ['Team', teamNickname],
    ['Referred by', referralName],
    ['Signed up', signedUpAt],
  ]
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${fullName || nickname || email || 'A new player'} just signed up${referralName ? ` (referred by ${referralName})` : ''}.`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>New Major7s Signup</Heading>
          </Section>
          <Section style={contentSection}>
            <Text style={text}>
              A new player just created an account and is awaiting approval.
            </Text>

            <Section style={table}>
              {rows
                .filter(([, v]) => v && String(v).trim())
                .map(([k, v]) => (
                  <Row key={k} style={tr}>
                    <Column style={th}>{k}</Column>
                    <Column style={td}>{v}</Column>
                  </Row>
                ))}
            </Section>

            <Text style={text}>
              Approve or review in the{' '}
              <Link href={url} style={anchor}>admin panel</Link>.
            </Text>

            <Hr style={hr} />
            <Text style={footer}>
              You're receiving this because you're the Major7s admin.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AdminNewUserEmail,
  subject: (d: Record<string, any>) =>
    `New Major7s signup: ${d.nickname || d.fullName || d.email || 'unknown'}`,
  displayName: 'Admin: new user signup',
  to: 'rob@rjparker.co.uk',
  previewData: {
    nickname: 'TestPlayer',
    fullName: 'Test Player',
    email: 'test@example.com',
    phone: '+44 7000 000000',
    referralName: 'Rob Parker',
    teamNickname: 'TestPlayer',
    signedUpAt: 'Jun 17, 2026, 4:30 PM',
    adminUrl: 'https://www.major7s.com/admin',
  },
} satisfies TemplateEntry

export default AdminNewUserEmail

const FOREST = '#103D2E'
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '24px 0' }
const container = { backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '560px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }
const header = { backgroundColor: FOREST, padding: '24px 28px' }
const headerHeading = { color: '#ffffff', fontSize: '20px', lineHeight: '1.3', fontWeight: 'bold' as const, margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const contentSection = { padding: '28px' }
const text = { fontSize: '15px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px' }
const table = { border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', margin: '4px 0 20px' }
const tr = { borderBottom: '1px solid #e5e7eb' }
const th = { width: '130px', padding: '10px 14px', fontSize: '13px', color: FOREST, fontWeight: 'bold' as const, backgroundColor: '#f9fafb' }
const td = { padding: '10px 14px', fontSize: '14px', color: '#1f2937' }
const anchor = { color: FOREST, textDecoration: 'underline' }
const hr = { borderColor: '#e5e7eb', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#6b7280', lineHeight: '1.5', margin: 0 }
