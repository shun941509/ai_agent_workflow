import type { NextConfig } from "next";
const config: NextConfig = { reactStrictMode: true, poweredByHeader: false, devIndicators: false, distDir: process.env.STUDIO_NEXT_DIR || ".next" };
export default config;
