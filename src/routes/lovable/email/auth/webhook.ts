import * as React from 'react'
import { render, toPlainText } from '@react-email/components'
import { parseEmailWebhookPayload } from '@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from '@lovable.dev/webhooks-js'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: "You're in — set up your Major7s account",
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "major7s"
const SENDER_DOMAIN = "notify.www.major7s.com"
const ROOT_DOMAIN = "www.major7s.com"
const FROM_DOMAIN = "www.major7s.com"

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function appendAuthParams(baseUrl: string, tokenHash: string, emailType: string) {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', emailType)
    return url.toString()
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(emailType)}`
  }
}

function buildConfirmationUrl({
  rawData,
  emailData,
  emailType,
}: {
  rawData: Record<string, unknown>
  emailData: Record<string, unknown>
  emailType: string
}) {
  const suppliedUrl = pickString(rawData, 'url', 'confirmation_url', 'confirmationUrl')
  if (emailType !== 'recovery') return suppliedUrl ?? `https://${ROOT_DOMAIN}`

  const redirectTo =
    pickString(emailData, 'redirect_to', 'redirectTo') ??
    pickString(rawData, 'redirect_to', 'redirectTo') ??
    `https://${ROOT_DOMAIN}/reset-password`
  const tokenHash = pickString(emailData, 'token_hash') ?? pickString(rawData, 'token_hash')
  const actionType =
    pickString(emailData, 'email_action_type') ?? pickString(rawData, 'email_action_type', 'action_type') ?? 'recovery'

  return tokenHash ? appendAuthParams(redirectTo, tokenHash, actionType) : suppliedUrl ?? redirectTo
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          console.error('LOVABLE_API_KEY not configured')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify signature + timestamp, then parse payload.
        let payload: any
        let run_id = ''
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          })
          payload = verified.payload
          run_id = payload.run_id
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case 'invalid_signature':
              case 'missing_timestamp':
              case 'invalid_timestamp':
              case 'stale_timestamp':
                console.error('Invalid webhook signature', { error: error.message })
                return Response.json(
                  { error: 'Invalid signature' },
                  { status: 401 }
                )
              case 'invalid_payload':
              case 'invalid_json':
                console.error('Invalid webhook payload', { error: error.message })
                return Response.json(
                  { error: 'Invalid webhook payload' },
                  { status: 400 }
                )
            }
          }

          console.error('Webhook verification failed', { error })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (!run_id) {
          console.error('Webhook payload missing run_id')
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (payload.version !== '1') {
          console.error('Unsupported payload version', { version: payload.version, run_id })
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 }
          )
        }

        const payloadRecord = payload as Record<string, unknown>
        const rawData = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord
        const emailData = isRecord(rawData.email_data)
          ? rawData.email_data
          : isRecord(payloadRecord.email_data)
            ? payloadRecord.email_data
            : rawData
        const user = isRecord(rawData.user)
          ? rawData.user
          : isRecord(payloadRecord.user)
            ? payloadRecord.user
            : {}

        // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
        // payload.type is the hook event type ("auth")
        const emailType =
          pickString(rawData, 'action_type', 'email_action_type') ??
          pickString(emailData, 'email_action_type')
        const recipientEmail = pickString(rawData, 'email') ?? pickString(user, 'email')
        if (!emailType || !recipientEmail) {
          console.error('Webhook payload missing email type or recipient', { run_id })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }
        console.log('Received auth event', {
          emailType,
          email_redacted: redactEmail(recipientEmail),
          run_id,
        })

        const EmailTemplate = EMAIL_TEMPLATES[emailType]
        if (!EmailTemplate) {
          console.error('Unknown email type', { emailType, run_id })
          return Response.json(
            { error: `Unknown email type: ${emailType}` },
            { status: 400 }
          )
        }

        // Build template props from payload.data (HookData structure)
        const userMeta = (isRecord(user.user_metadata) ? user.user_metadata : {}) as Record<string, unknown>
        const firstName =
          typeof userMeta.first_name === 'string' ? (userMeta.first_name as string) : undefined
        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: recipientEmail,
          confirmationUrl: buildConfirmationUrl({ rawData, emailData, emailType }),
          token: pickString(emailData, 'token') ?? pickString(rawData, 'token'),
          email: recipientEmail,
          oldEmail: pickString(emailData, 'old_email') ?? pickString(rawData, 'old_email'),
          newEmail: pickString(emailData, 'new_email') ?? pickString(rawData, 'new_email'),
          firstName,
        }

        // Render React Email to HTML and plain text
        const element = React.createElement(EmailTemplate, templateProps)
        const html = await render(element)
        const text = toPlainText(html)

        // Enqueue email for async processing by the dispatcher (process-email-queue).
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('Missing Supabase environment variables')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const messageId = crypto.randomUUID()

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: recipientEmail,
          status: 'pending',
        })

        const { error: enqueueError } = await supabase.rpc('enqueue_email', {
          queue_name: 'auth_emails',
          payload: {
            run_id,
            message_id: messageId,
            to: recipientEmail,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: EMAIL_SUBJECTS[emailType] || 'Notification',
            html,
            text,
            purpose: 'transactional',
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        })

        if (enqueueError) {
          console.error('Failed to enqueue auth email', { error: enqueueError, run_id, emailType })
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: recipientEmail,
            status: 'failed',
            error_message: 'Failed to enqueue email',
          })
          return Response.json(
            { error: 'Failed to enqueue email' },
            { status: 500 }
          )
        }

        console.log('Auth email enqueued', {
          emailType,
          email_redacted: redactEmail(recipientEmail),
          run_id,
        })

        return Response.json({ success: true, queued: true })
      },
    },
  },
})
