Call the `sendPicksConfirmationTest` server function on the published site with:

```
tournamentId: 08022118-1ee9-42b9-ae0e-6f2e203e6489
teamId:       762df4bf-11a7-41d3-bf7b-90a6be58deb2
recipientEmail: rob@rjparker.co.uk
```

## Steps

1. Use `stack_modern--invoke-server-function` to POST to the TanStack server-function endpoint for `sendPicksConfirmationTest` with the payload above. This requires an authenticated admin session — the invoker runs unauthenticated, so this will return 401/Unauthorized unless we route it through a signed-in admin browser session instead.
2. If the unauthenticated invoke is rejected (expected, since the fn uses `requireSupabaseAuth` + `has_role('admin')`), fall back to driving Playwright against the running preview as a signed-in admin and call the server fn from the browser console, capturing the returned `{ ok, recipientEmail, idempotencyKey, templateData, sendStatus }`.
3. Report back the full response: idempotency key, templateData (firstName, tournamentName, year, location, startDate, endDate, deadline, teamNickname, picks[1..7], tournamentUrl, tweakCount), send status, and whether the email was accepted into the queue.

## Note

No code changes. This is a diagnostic invocation only. If the send succeeds the email lands at rob@rjparker.co.uk within a few minutes (queue runs every 5s, subject to throttling).

Confirm to proceed and I'll run it.