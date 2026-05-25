import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone /admin/users screen has been retired. User management now lives
// in the admin console (the Users tab of /admin), which is the single canonical
// place to search, filter, manage roles/teams, approve, and simulate users.
// This route redirects so any existing links/bookmarks still resolve.
export const Route = createFileRoute("/_authenticated/admin/users")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
