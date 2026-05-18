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
    course: "Augusta",
    start_date: "2099-04-01",
    end_date: "2099-04-04",
    lock_at: "2099-04-01T00:00:00.000Z",
    status: "open" as const,
  },
  // Open but lock already passed → hub only
  {
    id: "t-open-expired",
    name: "Open Locked Major",
    course: "Pebble",
    start_date: "2020-06-01",
    end_date: "2020-06-04",
    lock_at: "2020-06-01T00:00:00.000Z",
    status: "open" as const,
  },
  // Upcoming → hub
  {
    id: "t-upcoming",
    name: "Upcoming Major",
    course: "St Andrews",
    start_date: "2099-07-01",
    end_date: "2099-07-04",
    lock_at: "2099-07-01T00:00:00.000Z",
    status: "upcoming" as const,
  },
  // Live → hub
  {
    id: "t-live",
    name: "Live Major",
    course: "Oakmont",
    start_date: "2099-05-01",
    end_date: "2099-05-04",
    lock_at: "2099-05-01T00:00:00.000Z",
    status: "live" as const,
  },
  // Locked → hub
  {
    id: "t-locked",
    name: "Locked Major",
    course: "Bethpage",
    start_date: "2099-08-01",
    end_date: "2099-08-04",
    lock_at: "2099-08-01T00:00:00.000Z",
    status: "locked" as const,
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
  it("deep-links to /lineup when open and lock is in the future", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(
      tournamentCardLink(
        { id: "a", status: "open", lock_at: "2026-06-01T00:00:00Z" },
        now,
      ),
    ).toEqual({ to: "/tournament/$id/lineup", params: { id: "a" } });
  });

  it("falls back to hub when open but lock has expired", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(
      tournamentCardLink(
        { id: "a", status: "open", lock_at: "2020-01-01T00:00:00Z" },
        now,
      ),
    ).toEqual({ to: "/tournament/$id", params: { id: "a" } });
  });

  it.each(["upcoming", "locked", "live", "completed"])(
    "routes to hub for status=%s",
    (status) => {
      expect(
        tournamentCardLink(
          { id: "x", status, lock_at: "2099-01-01T00:00:00Z" },
          Date.parse("2026-01-01T00:00:00Z"),
        ),
      ).toEqual({ to: "/tournament/$id", params: { id: "x" } });
    },
  );
});

describe("Home tournament cards (e2e render)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one anchor per tournament with the correct href + params", async () => {
    await renderHome();

    const expected: Record<string, string> = {
      "t-open-future": "/tournament/t-open-future/lineup",
      "t-open-expired": "/tournament/t-open-expired",
      "t-upcoming": "/tournament/t-upcoming",
      "t-live": "/tournament/t-live",
      "t-locked": "/tournament/t-locked",
    };

    for (const t of tournaments) {
      const heading = screen.getByText(t.name);
      const anchor = heading.closest("a");
      expect(anchor, `anchor for ${t.id}`).not.toBeNull();
      expect(anchor!.getAttribute("href")).toBe(expected[t.id]);
    }
  });

  it('shows "Enter Lineup" CTA only on cards whose link targets /lineup', async () => {
    await renderHome();

    const openCard = screen.getByText("Open Future Major").closest("a")!;
    expect(within(openCard).getByText(/Enter Lineup/i)).toBeInTheDocument();
    expect(openCard.getAttribute("href")).toMatch(/\/lineup$/);

    const expiredCard = screen.getByText("Open Locked Major").closest("a")!;
    expect(within(expiredCard).queryByText(/Enter Lineup/i)).toBeNull();
    expect(expiredCard.getAttribute("href")).not.toMatch(/\/lineup$/);
  });
});
