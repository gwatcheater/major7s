import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'

interface WelcomeEmailProps {
  firstName?: string
  appUrl?: string
}

const WelcomeEmail = ({ firstName, appUrl }: WelcomeEmailProps) => {
  const greeting = firstName && firstName.trim() ? `Welcome, ${firstName.trim()}!` : 'Welcome!'
  const url = appUrl && appUrl.trim() ? appUrl : 'https://www.major7s.com'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Welcome to Major7s — you're in.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Welcome To Major7s</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              Your account is ready. Major7s is where the crew picks majors, tracks the
              leaderboard, and settles scores year after year.
            </Text>
            <Text style={text}>
              Jump in, make your picks before the next deadline, and keep an eye on the
              leaderboard as the tournament unfolds.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                Open Major7s
              </Button>
            </Section>

            <Text style={footer}>
              You're receiving this because an account was created for you on Major7s. If
              that wasn't you, just ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to Major7s',
  displayName: 'Welcome',
  previewData: { firstName: 'Rob', appUrl: 'https://www.major7s.com' },
} satisfies TemplateEntry

export default WelcomeEmail

const FOREST = '#103D2E'
const GOLD = '#C9A227'

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
const contentSection = {
  padding: '28px',
}
const text = {
  fontSize: '15px',
  color: '#1f2937',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const buttonWrap = {
  textAlign: 'center' as const,
  margin: '28px 0 20px',
}
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
const footer = {
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '1.5',
  borderTop: '1px solid #e5e7eb',
  paddingTop: '16px',
  margin: '24px 0 0',
}
