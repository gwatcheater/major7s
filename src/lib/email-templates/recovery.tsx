import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  firstName?: string
}

export const RecoveryEmail = ({
  confirmationUrl,
  firstName,
}: RecoveryEmailProps) => {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You're in — set up your Major7s account</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Major7s.com Is Live. Tweaked, Upgraded.</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>Major7s has moved to a brand-new home.</Text>
            <Text style={text}>
              Your account is already set up. We've pre-loaded your details and your full
              picks history, so everything from previous years is waiting for you — nothing
              to re-enter.
            </Text>
            <Text style={text}>
              There's one thing left to do: set a password and you're ready to play.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={confirmationUrl}>
                Set your password
              </Button>
            </Section>

            <Text style={fallbackLabel}>Or paste this link into your browser:</Text>
            <Text style={fallbackLink}>
              <Link href={confirmationUrl} style={fallbackLinkAnchor}>
                {confirmationUrl}
              </Link>
            </Text>

            <Text style={footer}>
              You're receiving this because you have previously played Major7s. If you
              weren't expecting it, you can safely ignore this email — no account changes
              will be made until you set a password.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default RecoveryEmail

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
const fallbackLabel = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '20px 0 6px',
}
const fallbackLink = {
  fontSize: '12px',
  wordBreak: 'break-all' as const,
  margin: '0 0 24px',
}
const fallbackLinkAnchor = {
  color: FOREST,
  textDecoration: 'underline',
}
const footer = {
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '1.5',
  borderTop: '1px solid #e5e7eb',
  paddingTop: '16px',
  margin: '24px 0 0',
}
