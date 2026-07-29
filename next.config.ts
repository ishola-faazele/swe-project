import type { NextConfig } from "next";

if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_PHONE) {
  throw new Error("SERVER STARTUP FAILED: You must provide either an ADMIN_EMAIL or an ADMIN_PHONE in your environment variables.");
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
