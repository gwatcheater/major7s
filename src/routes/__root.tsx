import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Major7s" },
      { name: "description", content: "Major7s" },
      { property: "og:title", content: "Major7s" },
      { name: "twitter:title", content: "Major7s" },
      { property: "og:description", content: "Major7s" },
      { name: "twitter:description", content: "Major7s" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5b562c4b-79d4-4529-8f97-4c01bba77415/id-preview-153a4635--ddc5fca9-4f56-4e27-b687-3d128d3726dc.lovable.app-1779231359064.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5b562c4b-79d4-4529-8f97-4c01bba77415/id-preview-153a4635--ddc5fca9-4f56-4e27-b687-3d128d3726dc.lovable.app-1779231359064.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
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
