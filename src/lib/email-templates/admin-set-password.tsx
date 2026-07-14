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

import type { TemplateEntry } from './registry'

interface AdminSetPasswordProps {
  firstName?: string
  password: string
  loginUrl: string
}

const AdminSetPasswordEmail = ({ firstName, password, loginUrl }: AdminSetPasswordProps) => {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  const url = loginUrl && loginUrl.trim() ? loginUrl : 'https://www.major7s.com/login'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Major7s password has been reset — log in with your temporary password.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Your password was reset</Heading>
          </Section>

          <Section style={contentSection}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              An administrator has set a temporary password on your Major7s account. Use it to log
              in — you'll be asked to choose a new password straight away.
            </Text>

            <Section style={passwordWrap}>
              <Text style={passwordLabel}>Temporary password</Text>
              <Text style={passwordValue}>{password}</Text>
            </Section>

            <Section style={buttonWrap}>
              <Button style={button} href={url}>
                Log In
              </Button>
            </Section>

            <Text style={fallbackLabel}>Button not working? Use this link:</Text>
            <Text style={fallbackLink}>
              <Link href={url} style={fallbackLinkAnchor}>
                {url}
              </Link>
            </Text>

            <Text style={footer}>
              You're receiving this because an administrator reset your Major7s password. If you
              weren't expecting it, please contact us right away.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AdminSetPasswordEmail,
  subject: 'Your Major7s password has been reset',
  displayName: 'Admin set password',
  previewData: {
    firstName: 'Jamie',
    password: 'Temp-Pass-1234',
    loginUrl: 'https://www.major7s.com/login',
  },
} satisfies TemplateEntry

export default AdminSetPasswordEmail

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
const passwordWrap = {
  backgroundColor: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '16px 20px',
  margin: '20px 0',
  textAlign: 'center' as const,
}
const passwordLabel = {
  fontSize: '11px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '0 0 6px',
}
const passwordValue = {
  fontSize: '20px',
  fontFamily: 'Menlo, Consolas, monospace',
  fontWeight: 'bold' as const,
  color: FOREST,
  letterSpacing: '1px',
  margin: 0,
  wordBreak: 'break-all' as const,
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
