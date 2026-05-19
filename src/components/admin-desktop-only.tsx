import { Link } from "@tanstack/react-router";
import { Monitor } from "lucide-react";

/**
 * Wrap admin route content. On mobile/tablet (< md) shows a notice.
 * On desktop (>= md) renders children normally. CSS-only so SSR works.
 */
export function AdminDesktopOnly({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="md:hidden min-h-[80vh] flex items-center justify-center px-6 py-12">
        <div className="max-w-sm text-center bg-card border border-border rounded-sm p-8 shadow-sm">
          <div className="mx-auto mb-4 size-12 rounded-full grid place-items-center" style={{ backgroundColor: "var(--gold-soft)" }}>
            <Monitor className="size-6" style={{ color: "var(--gold)" }} />
          </div>
          <h1 className="font-display text-xl uppercase tracking-tight mb-2">Desktop Required</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Admin tools need a larger screen. Switch to a desktop or tablet in landscape to manage tournaments, users, and picks.
          </p>
          <Link
            to="/home"
            className="inline-block px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white rounded-sm"
            style={{ backgroundColor: "var(--forest-deep)" }}
          >
            ← Back to Clubhouse
          </Link>
        </div>
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
