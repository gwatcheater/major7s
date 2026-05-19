import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/hall-of-fame")({
  component: () => (
    <div className="p-4 md:p-12 max-w-4xl">
      <h1 className="font-display text-4xl uppercase mb-3">Hall of Fame</h1>
      <p className="text-sm text-muted-foreground">All-time leaderboards, Grand Slam Tracker, and Wooden Spoons Wall of Shame.</p>
    </div>
  ),
});
