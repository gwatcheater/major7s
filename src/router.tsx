import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // FIX: disabled scrollRestoration. TanStack Router's scroll restoration on
    // Chrome iOS can initialise the page at a non-zero scroll offset on first
    // load, making content appear clipped under the header until the user
    // scrolls. Safari handles this correctly; Chrome iOS does not.
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
