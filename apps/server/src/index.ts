import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Elysia } from "elysia";
import { auth } from "./auth";
import { databaseReady, db, user } from "@central-identity/db";
import { enrollmentInvitation } from "@central-identity/db/schema";



const app = new Elysia()
  .onRequest(async ({ request, set }) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/oauth2/authorize") {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return;
      const [identity] = await db.select({ disabled: user.disabled }).from(user)
        .where(eq(user.id, session.user.id)).limit(1);
      if (identity?.disabled) return new Response("Central Identity is disabled", { status: 403 });
      return;
    }
    if (path !== "/api/auth/sign-up/email") return;
    const token = request.headers.get("x-enrollment-invitation");
    let body: { email?: unknown };
    try {
      body = await request.clone().json();
    } catch {
      set.status = 400;
      return new Response("A valid enrollment invitation is required", { status: 400 });
    }
    if (typeof token !== "string" || typeof body.email !== "string") {
      set.status = 403;
      return new Response("A valid enrollment invitation is required", { status: 403 });
    }
    const [invitation] = await db.select({ id: enrollmentInvitation.id }).from(enrollmentInvitation).where(and(
      eq(enrollmentInvitation.tokenHash, createHash("sha256").update(token).digest("hex")),
      eq(enrollmentInvitation.email, body.email.trim().toLowerCase()),
      gt(enrollmentInvitation.expiresAt, new Date()),
      isNull(enrollmentInvitation.consumedAt),
    )).limit(1);
    if (!invitation) return new Response("A valid enrollment invitation is required", { status: 403 });
  })
  .onAfterHandle(async ({ request, response }) => {
    if (!(response instanceof Response) || !response.ok || new URL(request.url).pathname !== "/api/auth/sign-up/email") return;
    const token = request.headers.get("x-enrollment-invitation");
    const body = await request.clone().json() as { email: string };
    if (token) await db.update(enrollmentInvitation).set({ consumedAt: new Date() }).where(and(
      eq(enrollmentInvitation.tokenHash, createHash("sha256").update(token).digest("hex")),
      eq(enrollmentInvitation.email, body.email.trim().toLowerCase()),
      isNull(enrollmentInvitation.consumedAt),
    ));
  })
  .onAfterHandle(({ request, response }) => {
    if (!(response instanceof Response)) return;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/auth/sign-in/email") {
      console.info(JSON.stringify({
        event: response.ok ? "authentication.success" : "authentication.failure",
        action: "password_sign_in",
        status: response.status,
      }));
      return;
    }
    if (pathname !== "/api/auth/oauth2/authorize" || response.status < 300 || response.status >= 400) return;
    const destination = response.headers.get("location");
    if (!destination || !new URL(destination, request.url).searchParams.has("code")) return;
    console.info(JSON.stringify({
      event: "authentication.success",
      action: "oidc_authorization",
      status: response.status,
    }));
  })
  .get("/health/live", () => ({ status: "live" }))
  .get("/health/ready", async ({ set }) => {
    try {
      await databaseReady();
      return { status: "ready" };
    } catch {
      set.status = 503;
      return { status: "not_ready" };
    }
  })
  .mount(auth.handler)
  .listen({ hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });

console.log(`Central Identity listening on ${app.server?.hostname}:${app.server?.port}`);
