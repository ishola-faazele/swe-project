import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_PHONE) {
  throw new Error("SERVER STARTUP FAILED: You must provide either an ADMIN_EMAIL or an ADMIN_PHONE in your environment variables.");
}

import os from "os";

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = ["127.0.0.1", "localhost"];
  for (const name of Object.keys(interfaces)) {
    for (const iface of (interfaces[name] || [])) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

const nextConfig: NextConfig = {
  // Dynamically generated list of local IPs so the dev server doesn't block HMR
  allowedDevOrigins: getLocalIpAddresses(),
  turbopack: {},
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [{ url: "/~offline", revision: "1" }],
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
