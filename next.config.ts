import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_PHONE) {
  throw new Error("SERVER STARTUP FAILED: You must provide either an ADMIN_EMAIL or an ADMIN_PHONE in your environment variables.");
}

const nextConfig: NextConfig = {
  // This app requires 127.0.0.1 (not localhost) — Supabase's PKCE code_verifier cookie is
  // scoped to the exact origin used to sign in, and the whole auth flow (NEXT_PUBLIC_SITE_URL,
  // the Supabase redirect URLs) is built around 127.0.0.1. But Next.js's dev server only trusts
  // `localhost` for dev-only asset/HMR requests by default, so without this, every request from
  // 127.0.0.1 — including the HMR WebSocket upgrade — is treated as a blocked cross-origin
  // request. That breaks hot-reload, and this Next.js version's dev-mode hydrate() call is
  // wired directly to establishing that socket, so it can take client-side interactivity down
  // with it. See node_modules/next/dist/docs/.../allowedDevOrigins.md.
  allowedDevOrigins: ["127.0.0.1", "10.205.46.41"],
  turbopack: {},
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [{ url: "/~offline", revision: "1" }],
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
