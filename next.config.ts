import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ['sharp'],
  experimental: {
  },
};

export default nextConfig;
