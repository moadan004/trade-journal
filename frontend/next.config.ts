import type { NextConfig } from "next";

// Where the FastAPI backend actually lives. Read server-side only (no
// NEXT_PUBLIC_ prefix) so the backend URL never ships in the client bundle.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Proxy /api/* to the backend so the browser only ever talks to its own
  // origin. This is what lets the auth cookie stay SameSite=lax: a direct
  // Vercel -> Render call would be cross-site, and Lax/Strict cookies are not
  // sent on cross-site requests, so auth would silently fail in production.
  // Keeping it same-site also means no CSRF token scheme and no production CORS.
  //
  // The /api prefix is stripped: /api/auth/login -> <backend>/auth/login.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
