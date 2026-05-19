import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useImpersonation } from "@/context/impersonation-context";

export function ImpersonationBanner() {
  const { impersonatingId, impersonatedProfile, stopImpersonation } = useImpersonation();
  const navigate = useNavigate();

  if (!impersonatingId) return null;

  const fullName =
    [impersonatedProfile?.first_name, impersonatedProfile?.last_name].filter(Boolean).join(" ") ||
    impersonatedProfile?.nickname ||
    "user";
  const team = impersonatedProfile?.team_nickname ?? impersonatedProfile?.nickname ?? "—";

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-500 text-amber-950 shadow-lg border-t border-amber-700">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          ⚠️ SHADOW MODE ACTIVE: Currently simulating <strong>{fullName}</strong> (Team: <strong>{team}</strong>)
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="bg-amber-950 text-amber-50 hover:bg-amber-900"
          onClick={() => {
            stopImpersonation();
            navigate({ to: "/admin" });
          }}
        >
          🛑 Stop Simulation
        </Button>
      </div>
    </div>
  );
}
