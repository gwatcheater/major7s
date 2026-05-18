import { createFileRoute } from "@tanstack/react-router";
function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-12 max-w-4xl">
      <h1 className="font-display text-4xl uppercase mb-3">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
export const Route = createFileRoute("/_authenticated/archive")({
  component: () => <Placeholder title="Event Archive" body="Completed tournaments and historical analytics will appear here as the season progresses." />,
});
