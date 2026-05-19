import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { tournamentCardLink } from "@/lib/tournament-link";

// --- Mocks ----------------------------------------------------------------

const tournaments = [
  // Open + lock in the future → must deep-link to /lineup
  {
    id: "t-open-future",
    name: "Open Future Major",
    location: "Augusta",
    start_date: "2099-04-01",
    end_date: "2099-04-04",
    submission_deadline: "2099-04-01T00:00:00.000Z",
    status: "open_for_picks" as const,
  },
  // Open but lock already passed → hub only
  {
    id: "t-open-expired",
    name: "Open Locked Major",
    location: "Pebble",
    start_date: "2020-06-01",
    end_date: "2020-06-04",
    submission_deadline: "2020-06-01T00:00:00.000Z",
    status: "open_for_picks" as const,
  },
  // Upcoming → hub
  {
    id: "t-upcoming",
    name: "Upcoming Major",
    location: "St Andrews",
    start_date: "2099-07-01",
    end_date: "2099-07-04",
    submission_deadline: "2099-07-01T00:00:00.000Z",
    status: "upcoming" as const,
  },
  // Live → hub
  {
    id: "t-live",
    name: "Live Major",
    location: "Oakmont",
    start_date: "2099-05-01",
    end_date: "2099-05-04",
    submission_deadline: "2099-05-01T00:00:00.000Z",
    status: "live" as const,
  },
  // Locked → hub
  {
    id: "t-locked",
    name: "Locked Major",
    location: "Bethpage",
    start_date: "2099-08-01",
    end_date: "2099-08-04",
    submission_deadline: "2099-08-01T00:00:00.000Z",
    status: "picks_closed" as const,
  },
];

vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() =>
      Promise.resolve({ data: tournaments, error: null }),
    ),
    then: undefined,
  };
  // For pick counts query: from("picks").select(...,{count,head}).eq().eq()
  const picksBuilder: any = {
    select: vi.fn(() => picksBuilder),
    eq: vi.fn(() => picksBuilder),
    then: (resolve: any) => resolve({ count: 0, error: null }),
  };
  return {
    supabase: {
      from: vi.fn((table: string) =>
        table === "picks" ? picksBuilder : builder,
      ),
    },
  };
});

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    activeTeam: null,
    teams: [],
    setActiveTeamId: () => {},
    loading: false,
    refetch: () => {},
  }),
}));

vi.mock("@/components/countdown", () => ({
  Countdown: () => null,
}));

// --- Helpers --------------------------------------------------------------

async function renderHome() {
  const { Route: HomeRoute } = await import(
    "@/routes/_authenticated/home"
  );
  const HomeComponent = (HomeRoute.options as any).component;

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: HomeComponent,
  });
  // Stub destinations so type-checked Links resolve.
  const hubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tournament/$id",
    component: () => <div>hub</div>,
  });
  const lineupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tournament/$id/lineup",
    component: () => <div>lineup</div>,
  });

  const routeTree = rootRoute.addChildren([homeRoute, hubRoute, lineupRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );

  // Wait until tournament cards mount.
  await screen.findByText(tournaments[0].name, {}, { timeout: 3000 });
}

// --- Tests ----------------------------------------------------------------

describe("tournamentCardLink helper", () => {
  it.each([
    ["open_for_picks", "2099-01-01T00:00:00Z"],
    ["open_for_picks", "2020-01-01T00:00:00Z"],
    ["upcoming", "2099-01-01T00:00:00Z"],
    ["picks_closed", "2099-01-01T00:00:00Z"],
    ["live", "2099-01-01T00:00:00Z"],
    ["completed", "2099-01-01T00:00:00Z"],
  ])("always routes to the hub (status=%s)", (status, deadline) => {
    expect(
      tournamentCardLink(
        { id: "x", status, submission_deadline: deadline },
        Date.parse("2026-01-01T00:00:00Z"),
      ),
    ).toEqual({ to: "/tournament/$id", params: { id: "x" } });
  });
});

describe("Home tournament cards (e2e render)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("every card's primary click target navigates to the hub", async () => {
    await renderHome();

    for (const t of tournaments) {
      const heading = screen.getByText(t.name);
      const card = heading.closest("div.relative.bg-card") as HTMLElement;
      expect(card, `card for ${t.id}`).not.toBeNull();
      const hubLink = within(card).getByLabelText(`Open ${t.name}`);
      expect(hubLink.getAttribute("href")).toBe(`/tournament/${t.id}`);
    }
  });

  it('shows nested "Enter Lineup" link only when picks are open and unexpired', async () => {
    await renderHome();

    const openCard = screen
      .getByText("Open Future Major")
      .closest("div.relative.bg-card") as HTMLElement;
    const cta = within(openCard).getByText(/Enter Lineup/i).closest("a");
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/tournament/t-open-future/lineup");

    const expiredCard = screen
      .getByText("Open Locked Major")
      .closest("div.relative.bg-card") as HTMLElement;
    expect(within(expiredCard).queryByText(/Enter Lineup/i)).toBeNull();
  });
});
