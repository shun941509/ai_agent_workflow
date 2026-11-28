import type { NextConfig } from "next";
// ZIPs and offline pages embed these modules as source even when the engine also bundles them.
const receiver = "./src/domain/inspection-receiver.mjs";
const recoverySource = [receiver, "./src/domain/markdown-section.mjs"];
const starterSource = [receiver, "./src/domain/inspection-starters.mjs"];
const config: NextConfig = {
  reactStrictMode: true, poweredByHeader: false, devIndicators: false, distDir: process.env.STUDIO_NEXT_DIR || ".next",
  outputFileTracingIncludes: {
    "/api/studio": [...recoverySource, "./src/domain/inspection-starters.mjs"],
    "/examples/equipment-inspection.html": [receiver],
    "/examples/equipment-inspection-recovery.html": recoverySource,
    "/examples/equipment-inspection-starters.html": starterSource,
  },
};
export default config;
