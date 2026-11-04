import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Central Identity" },
      { name: "description", content: "Sign in to your Central Identity." },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
  }),
  shellComponent: ({ children }: { children: ReactNode }) => (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  ),
});
