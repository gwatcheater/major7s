Run the diagnostic `sendPicksConfirmationTest` server function now that an admin session is available in the sandbox.

## Call

```
tournamentId:   08022118-1ee9-42b9-ae0e-6f2e203e6489
teamId:         762df4bf-11a7-41d3-bf7b-90a6be58deb2
recipientEmail: rob@rjparker.co.uk
```

## Steps

1. Drive Playwright against `http://localhost:8080`, restore the injected Supabase session into `localStorage`, then navigate to an authenticated route so the app picks up the session.
2. From the page context, grab the access token via `supabase.auth.getSession()` and POST to the TanStack server-fn endpoint for `sendPicksConfirmationTest` with the payload above and `Authorization: Bearer <token>`.
3. Capture the JSON response and report back:
   - `ok`, `sendStatus`, `sendBody` (if any)
   - `idempotencyKey`
   - full `templateData` (firstName, tournamentName, year, location, startDate, endDate, deadline, teamNickname, picks[1..7], tournamentUrl, tweakCount)
4. If the send is accepted, note that the queue processor runs every ~5s and the email should land at rob@rjparker.co.uk shortly.

No code changes — diagnostic only.
