import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/stats")({
  component: () => (
    <div className="p-12 max-w-4xl">
      <h1 className="font-display text-4xl uppercase mb-3">Global Stats</h1>
      <p className="text-sm text-muted-foreground">Individual and community performance analytics will appear here.</p>
    </div>
  ),
});
