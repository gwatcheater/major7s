import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { TeamsProvider } from "@/hooks/use-teams";
import { NowProvider } from "@/hooks/use-now";
import { ImpersonationProvider } from "@/context/impersonation-context";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display">404</h1>
        <p className="mt-4 text-sm text-muted-foreground">This hole isn't on the scorecard.</p>
        <a href="/" className="mt-6 inline-block px-6 py-3 bg-primary text-primary-foreground font-display text-xs uppercase tracking-widest">
          Back to Clubhouse
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display">Something went sideways</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex gap-2 justify-center">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="px-4 py-2 bg-primary text-primary-foreground font-display text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { title: "Major7s" },
      { name: "description", content: "Pick smart. Tweak obsessively. Suffer beautifully. Major7s is the ultimate golf picks game across all four majors." },
      { property: "og:title", content: "Major7s" },
      { name: "twitter:title", content: "Major7s" },
      { property: "og:description", content: "Pick smart. Tweak obsessively. Suffer beautifully. Major7s is the ultimate golf picks game across all four majors." },
      { name: "twitter:description", content: "Pick smart. Tweak obsessively. Suffer beautifully. Major7s is the ultimate golf picks game across all four majors." },
      { property: "og:image", content: "https://www.major7s.com/apple-touch-icon.png" },
      { name: "twitter:image", content: "https://www.major7s.com/apple-touch-icon.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "icon", href: "/faviconf.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const u = new URL(window.location.href); if (u.pathname !== '/') return; const h = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash; const hp = new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : h); if (u.searchParams.get('type') === 'recovery' || hp.get('type') === 'recovery') window.location.replace('/reset-password' + u.search + u.hash); } catch (_) {} })();`,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthBridge() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    const resetFlag = "major7s:pending-password-reset";
    const sendRecoveryToReset = () => {
      const url = new URL(window.location.href);
      const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash);
      const isRecovery = url.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery";
      const hasAuthTokens = !!(hashParams.get("access_token") && hashParams.get("refresh_token"));
      const hasPendingReset = window.localStorage.getItem(resetFlag) === "1";
      if ((isRecovery || (hasAuthTokens && hasPendingReset)) && url.pathname !== "/reset-password") {
        window.location.replace(`/reset-password${url.search}${url.hash}`);
        return true;
      }
      return false;
    };

    if (sendRecoveryToReset()) return undefined;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        window.localStorage.setItem(resetFlag, "1");
        if (window.location.pathname !== "/reset-password") {
          window.location.replace("/reset-password");
          return;
        }
      }
      if (sendRecoveryToReset()) return;
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return null;
}

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

function LastSeenTracker() {
  const { user } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });
  const lastStampRef = useRef<number>(0);
  useEffect(() => {
    if (!user?.id) return;
    const now = Date.now();
    if (now - lastStampRef.current < LAST_SEEN_THROTTLE_MS) return;
    lastStampRef.current = now;
    void supabase
      .from("profiles")
      .update({ last_seen_at: new Date(now).toISOString() })
      .eq("id", user.id)
      .then(({ error }) => {
        if (error) console.warn("[last-seen] update failed", error.message);
      });
  }, [user?.id, pathname]);
  return null;
}


function RootComponent() {
  // Force rebuild trigger
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ImpersonationProvider>
          <TeamsProvider>
            <NowProvider>
              <AuthBridge />
              <LastSeenTracker />
              <Outlet />
              <ImpersonationBanner />
              <Toaster />
            </NowProvider>
          </TeamsProvider>
        </ImpersonationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
