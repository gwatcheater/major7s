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
      <Preview>Reset your Major7s password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Reset Your Password</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              We received a request to reset the password for your Major7s account.
              Click the button below to choose a new password.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={confirmationUrl}>
                Reset your password
              </Button>
            </Section>

            <Text style={footer}>
              If you didn't request a password reset, you can safely ignore this email —
              your password won't be changed.
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
