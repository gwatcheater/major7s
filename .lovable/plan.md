## Change

Remove the "Team Nickname" field from the Create Account form on `/login`. The signup will only collect **email** and **password**.

## Implementation

In `src/routes/login.tsx`:
- Remove the `nickname` state and the Team Nickname input block (around line 106) from the Sign Up tab.
- In the `signUp` call, drop the `data: { nickname: ... }` metadata, or fall back to `email.split("@")[0]` server-side.

## Backend note

The existing `handle_new_user` trigger already falls back to `split_part(NEW.email, '@', 1)` when no nickname metadata is provided, so removing the field requires no DB changes — new teams/profiles will be auto-named from the email prefix.