import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching } from "serwist";
import { Serwist, NetworkFirst } from "serwist";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const cacheStrategies: RuntimeCaching[] = [
  {
    // Match React Server Component (RSC) payload requests
    matcher: ({ request, url, sameOrigin }) =>
      request.headers.get("RSC") === "1" && sameOrigin && !url.pathname.startsWith("/api/"),
    handler: new NetworkFirst({
      cacheName: "rsc-payloads",
      networkTimeoutSeconds: 3,
    }),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: cacheStrategies,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
