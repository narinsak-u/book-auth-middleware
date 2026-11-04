import path from "node:path";

const clientDirectory = path.join(import.meta.dir, "dist/client");
const serverEntry = path.join(import.meta.dir, "dist/server/server.js");
// TanStack emits this server entry during the Vite build, so it cannot be statically imported before that build runs.
const { default: handler } = await import(serverEntry) as {
  default: { fetch(request: Request): Response | Promise<Response> };
};
const routes: Record<string, (request: Request) => Response> = {};

for await (const file of new Bun.Glob("**/*").scan({ cwd: clientDirectory })) {
  const route = `/${file.split(path.sep).join("/")}`;
  routes[route] = () => {
    const asset = Bun.file(path.join(clientDirectory, file));
    return new Response(asset, {
      headers: {
        "content-type": asset.type || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  };
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  routes,
  fetch: (request) => handler.fetch(request),
});

console.info(`Authentication Portal listening on ${server.hostname}:${server.port}`);
