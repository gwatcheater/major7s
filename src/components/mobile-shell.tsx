import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";

export function MobileTopBar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [stickyReady, setStickyReady] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Render with position:relative on the first paint so WKWebView (Chrome
  // iOS) treats the header as a normal in-flow element and pushes content
  // below it. Switching to sticky after the first frame ensures the layout
  // has already settled before the deferred sticky calculation takes effect.
  useEffect(() => {
    const id = requestAnimationFrame(() => setStickyReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <header
      className={`mobile-top-bar ${stickyReady ? "sticky" : "relative"} top-0 z-50 flex items-center justify-between px-4 border-b border-white/10 lg:hidden`}
      style={{ backgroundColor: "var(--forest-deep)" }}
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Open menu"
            className="size-10 -ml-2 grid place-items-center text-white hover:bg-white/10 rounded-sm"
          >
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72 max-w-[85vw] border-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <AppSidebar variant="drawer" />
        </SheetContent>
      </Sheet>

      <Link to="/home" className="font-display text-lg tracking-tight uppercase text-white">
        Major<span style={{ color: "var(--gold)" }}>7s</span>
      </Link>

      <Link
        to="/profile"
        className="size-9 rounded-full bg-white/10 border border-white/20 grid place-items-center font-display text-xs text-white/80"
      >
        {user?.email?.[0]?.toUpperCase() ?? "?"}
      </Link>
    </header>
  );
}
