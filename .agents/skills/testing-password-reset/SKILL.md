---
name: testing-password-reset
description: Test the forgot-password and reset-password flows end-to-end. Use when verifying auth recovery UI or Supabase PKCE flow changes.
---

# Testing Password Reset Flow

## Prerequisites

- Dev server running: `npm run dev` (serves on localhost:8080)
- Supabase credentials injected via environment (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

## Devin Secrets Needed

- `MAJOR7S_ADMIN_EMAIL` — test account email for sending reset links
- `MAJOR7S_ADMIN_PASSWORD` — test account password for login verification

## Key Pages

- `/login` — has "Forgot password?" button that switches to forgot-password mode
- `/reset-password` — recovery landing page that processes URL tokens

## Test Flows

### 1. Forgot-Password UI Mode (login.tsx)

1. Navigate to `/login`
2. Click "Forgot password?" — UI should switch:
   - Title changes to "Reset password"
   - Subtitle: "Enter your email to receive a reset link."
   - Password field hidden, only email input + "Send Reset Link" button shown
   - "Back to Login" link visible
3. Enter email, click "Send Reset Link"
4. Success state: gold-bordered box with "Check your inbox for a reset link!" + "Back to Login" button

### 2. PKCE Code Verifier Verification

After sending a reset email, verify PKCE is active (not implicit flow):

```js
// In browser console after clicking "Send Reset Link":
Object.keys(localStorage).filter(k => k.includes('code-verifier'))
// Should return: ["sb-<project-ref>-auth-token-code-verifier"]
```

If no `code-verifier` key exists, the client might still be using implicit flow (`flowType` in `client.ts`).

### 3. Hard Timeout on /reset-password (No Tokens)

Visiting `/reset-password` with no URL tokens triggers the hard timeout:
- Shows "Waiting for recovery link..." initially
- Error appears after the configured timeout (check source for current value, was 15s as of June 2026)
- Error text: "Recovery link could not be verified. Please request a new reset link."
- "Back to login" button navigates to `/login`

For precise timing verification, use Playwright via CDP (`http://localhost:29229`):

```js
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://localhost:29229');
const page = browser.contexts()[0].pages()[0];
await page.goto('http://localhost:8080/login'); // reset state
await page.waitForTimeout(2000);
const start = Date.now();
await page.goto('http://localhost:8080/reset-password');
// Poll every 1s, check document.body.innerText for error text
```

### 4. Full Email→Reset Flow (Requires Email Access)

The complete end-to-end flow (send email → click link → set new password) requires access to the test account's email inbox. This cannot be fully automated without email access. The PKCE code_verifier test (step 2) confirms the client-side half of the fix.

## Architecture Notes

- Supabase client config is in `src/integrations/supabase/client.ts` — `flowType` setting controls implicit vs PKCE
- Recovery page (`src/routes/reset-password.tsx`) has a complex fallback chain:
  - `onAuthStateChange` listener fires first on PASSWORD_RECOVERY events
  - Manual fallback (`readRecoveryParams`) handles multiple token formats (PKCE code, token_hash, implicit tokens)
  - `readyRef` (useRef) guards against race conditions between listener and fallback
  - Hard timeout shows actionable error if nothing resolves

## Linting

- Run `npm run eslint` before committing
- Run `npm run tsc -- --noEmit` for type checking
- Use `npx eslint --fix <file>` to auto-fix prettier formatting issues
