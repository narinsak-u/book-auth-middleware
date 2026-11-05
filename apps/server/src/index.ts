import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { auth } from "./auth";
import { databaseReady, db, enrollmentInvitation, user } from "@central-identity/db";

const app = new Elysia()
  .onRequest(async ({ request }) => {
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
    if (!token) return new Response("A valid enrollment invitation is required", { status: 403 });
    let body: { email?: unknown };
    try {
      body = await request.clone().json();
    } catch {
      return new Response("A valid enrollment invitation is required", { status: 400 });
    }
    if (typeof body.email !== "string") {
      return new Response("A valid enrollment invitation is required", { status: 403 });
    }
    const email = body.email.trim().toLowerCase();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [invitation] = await db.select({
      expiresAt: enrollmentInvitation.expiresAt,
      consumedAt: enrollmentInvitation.consumedAt,
    }).from(enrollmentInvitation).where(and(
      eq(enrollmentInvitation.tokenHash, tokenHash),
      eq(enrollmentInvitation.email, email),
    )).limit(1);
    if (!invitation || invitation.consumedAt) {
      return new Response("A valid enrollment invitation is required", { status: 403 });
    }
    if (invitation.expiresAt <= new Date()) {
      return Response.json({ code: "INVITATION_EXPIRED" }, { status: 410 });
    }
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
