import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";

export function MobileTopBar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [path]);

  return (
    // FIX: removed `paddingTop: "env(safe-area-inset-top)"` from the inline style.
    // Chrome iOS does not resolve env() safe-area values correctly on first paint
    // when applied as inline styles — the value is treated as 0 initially, causing
    // the header height to be miscalculated, which cascades into the main content
    // area rendering at the wrong width. The fix is to use the `pt-safe` utility
    // (or remove it entirely, since the sticky header sits below the safe area on
    // most iPhones in portrait). The fixed h-14 height already provides sufficient
    // clearance on all current iPhone models.
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b border-white/10 lg:hidden"
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

      <Link to="/profile" className="size-9 rounded-full bg-white/10 border border-white/20 grid place-items-center font-display text-xs text-white/80">
        {user?.email?.[0]?.toUpperCase() ?? "?"}
      </Link>
    </header>
  );
}
