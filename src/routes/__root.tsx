import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { HfxBanner } from "@/components/HfxBanner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hasn't been written yet.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Weave — collaborative book writing" },
      {
        name: "description",
        content:
          "Turn the free-flowing conversations between you and your friends into a book, together.",
      },
      { property: "og:title", content: "Weave — collaborative book writing" },
      {
        property: "og:description",
        content:
          "Turn the free-flowing conversations between you and your friends into a book, together.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Weave — collaborative book writing" },
      { name: "description", content: "Weave transforms friend conversations into collaborative books, capturing voice messages and managing chapters." },
      { property: "og:description", content: "Weave transforms friend conversations into collaborative books, capturing voice messages and managing chapters." },
      { name: "twitter:description", content: "Weave transforms friend conversations into collaborative books, capturing voice messages and managing chapters." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8101c276-cf26-4ee6-b633-fb9d0e6d72b5/id-preview-6aac4277--d3e6caea-0a39-4c53-bbba-303a2af2958b.lovable.app-1777744127220.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8101c276-cf26-4ee6-b633-fb9d0e6d72b5/id-preview-6aac4277--d3e6caea-0a39-4c53-bbba-303a2af2958b.lovable.app-1777744127220.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <>
      <Outlet />
      <footer className="px-4 pb-6">
        <HfxBanner />
      </footer>
    </>
  );
}
