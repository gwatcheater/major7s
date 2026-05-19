## Scope

Rewrite `src/routes/_authenticated/profile.tsx` as `ProfileSettingsView`. No DB schema changes — `profiles` already has `first_name`, `last_name`, `phone`, `team_nickname`, `referral_name`, `nickname`, `email`.

## Layout

- `max-w-3xl mx-auto p-4 md:p-10`
- Top: `← Back to Dashboard` link (`/home`) + header ("Profile & Settings").
- Body: `flex flex-col gap-6` containing two `<section>` cards (`bg-card border rounded-md p-5 md:p-6`). Fully responsive; inputs use `py-2.5` for touch.

## 1. Personal Details card

`User` icon + "Personal Details" title.

Form fields (controlled state hydrated from `useQuery` of `profiles`):
- First Name / Last Name — `grid md:grid-cols-2 gap-4`, required.
- **Team Name (Leaderboard Display)** — exact label, bound to `team_nickname` (also mirrored into `nickname` on save so leaderboard stays in sync). Subtext: "This unique name will be visible to all players on the master leaderboard."
- Mobile Number — `type="tel" inputMode="tel"`, bound to `phone`, phone regex validation.
- Referral Name — text input, bound to `referral_name`.
- Email Address — disabled `<input>` showing `user.email` with absolutely-positioned `Lock` icon inside the field, plus subtext with lock icon: "Email address is tied to your account identity and cannot be changed."
- **Save Changes** button at bottom: validates required fields + phone format, then `supabase.from("profiles").update({...}).eq("id", user.id)`. Success toast: `"Profile updated successfully"`. Invalidates `["profile"]`.

## 2. Account Security card

`Shield` icon + "Account Security" title.

Three password inputs (`type="password"`, autoComplete hints):
- Current Password
- New Password (hint "Minimum 8 characters.")
- Confirm New Password

**Change Password** button:
1. Validate all three present, new ≥ 8 chars.
2. If `newPw !== confirmPw` → toast error "New password and confirmation do not match" and abort.
3. Re-auth: `supabase.auth.signInWithPassword({ email, password: currentPw })`. On failure → toast "Current password is incorrect".
4. `supabase.auth.updateUser({ password: newPw })` → toast "Password updated successfully" and clear all three fields.

## Removed from existing file

- Tab navigation + `TabButton` (single-page stack instead).
- "Team Names" sub-section + `TeamRow` helper (team name now lives directly in Personal Details).
- `useTeams` import.

## Notes

- Reuse the small `Field` + `Input` helpers (extended with `inputMode`/`autoComplete`) and `SkeletonForm`.
- Keep styling tokens (`var(--gold)`, `var(--forest-deep)`) consistent with the rest of the app.
- No new routes, no schema migration, no other files touched.