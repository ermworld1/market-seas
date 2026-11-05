import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { APP_BASEPATH } from "./lib/app-path";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    basepath: APP_BASEPATH,
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
