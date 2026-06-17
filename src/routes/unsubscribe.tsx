import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
  head: () => ({
    meta: [
      { title: 'Unsubscribe — Major7s' },
      { name: 'description', content: 'Manage your email subscription preferences for Major7s.' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})

type Status = 'loading' | 'ready' | 'already' | 'invalid' | 'submitting' | 'done' | 'error'

function UnsubscribePage() {
  const [status, setStatus] = React.useState<Status>('loading')
  const [message, setMessage] = React.useState<string>('')

  const token = React.useMemo(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('token') ?? ''
  }, [])

  React.useEffect(() => {
    if (!token) {
      setStatus('invalid')
      setMessage('No unsubscribe token was provided.')
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setStatus('invalid')
          setMessage(data?.error ?? 'This unsubscribe link is invalid or has expired.')
          return
        }
        if (data?.valid === false && data?.reason === 'already_unsubscribed') {
          setStatus('already')
          return
        }
        if (data?.valid) {
          setStatus('ready')
          return
        }
        setStatus('invalid')
      } catch {
        setStatus('error')
        setMessage('Something went wrong reaching the server. Please try again.')
      }
    })()
  }, [token])

  async function confirm() {
    setStatus('submitting')
    try {
      const res = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(data?.error ?? 'Failed to unsubscribe.')
        return
      }
      if (data?.success === false && data?.reason === 'already_unsubscribed') {
        setStatus('already')
        return
      }
      setStatus('done')
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-sm p-8">
        <h1 className="text-xl font-semibold mb-3">Email preferences</h1>

        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">Checking your link…</p>
        )}

        {status === 'ready' && (
          <>
            <p className="text-sm mb-6">
              Confirm you'd like to unsubscribe from Major7s emails. You can still sign in to
              your account at any time.
            </p>
            <button
              onClick={confirm}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Confirm unsubscribe
            </button>
          </>
        )}

        {status === 'submitting' && (
          <p className="text-sm text-muted-foreground">Unsubscribing…</p>
        )}

        {status === 'done' && (
          <p className="text-sm">
            You've been unsubscribed. We won't send you any further emails from Major7s.
          </p>
        )}

        {status === 'already' && (
          <p className="text-sm">This address is already unsubscribed. No further action needed.</p>
        )}

        {status === 'invalid' && (
          <p className="text-sm text-destructive">
            {message || 'This unsubscribe link is invalid or has expired.'}
          </p>
        )}

        {status === 'error' && (
          <p className="text-sm text-destructive">{message}</p>
        )}
      </div>
    </main>
  )
}
