import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/timeline(.*)",
  "/task(.*)",
  "/project(.*)",
  "/calendar(.*)",
  "/tasks(.*)",
  "/settings(.*)",
  "/oauth(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const back = new URL("/", req.url);
    // OAuth consent must resume after sign-in; the landing page honours redirect_url.
    if (req.nextUrl.pathname.startsWith("/oauth/")) back.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
    await auth.protect({ unauthenticatedUrl: back.toString() });
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
