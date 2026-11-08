import { eq } from "drizzle-orm";
import { databaseReady, db, oauthClient, user } from "@central-identity/db";
import * as JSONSchema from "effect/JSONSchema";
import * as Schema from "effect/Schema";
import { openapi } from "@elysia/openapi";
import { Elysia } from "elysia";
import { allowedOAuthCallback } from "./provision-oauth-client";
import { auth } from "./auth";

const oauthEnabled = process.env.NODE_ENV !== "production" || process.env.TEST_PRODUCTION === "true";
const openApiEnabled = process.env.NODE_ENV !== "production" && process.env.TEST_PRODUCTION !== "true";
const configurationSchema = Schema.Struct({ oauthEnabled: Schema.Boolean });
const healthLiveSchema = Schema.Struct({ status: Schema.Literal("live") });
const healthReadySchema = Schema.Struct({ status: Schema.Literal("ready", "not_ready") });
const destinationQuerySchema = Schema.Struct({
  client_id: Schema.String.pipe(Schema.minLength(1)).annotations({ description: "Registered Relying Party client identifier.", examples: ["example-client-id"] }),
  redirect_uri: Schema.String.pipe(Schema.minLength(1)).annotations({ description: "Exact callback destination registered for that client.", examples: ["https://example.test/callback"] }),
});
const destinationResponseSchema = Schema.Struct({ destination: Schema.NullOr(Schema.String) });
const destinationValidationSchema = Schema.Struct({ type: Schema.Literal("validation") });
const destinationQueryJsonSchema = JSONSchema.make(destinationQuerySchema) as {
  properties?: Record<string, { description?: string; examples?: unknown[] }>;
  required?: string[];
};
const jsonSchema = (schema: Schema.Schema.Any) => JSONSchema.make(schema) as never;

const authRequest = (
  properties: Record<string, { type: string; format?: string; description: string }>,
  required: string[],
  example: Record<string, string>,
) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", required, properties },
      example,
    },
  },
});
type AuthRequestBody = {
  required: true;
  content: {
    "application/json": {
      schema: { type: "object"; required: string[]; properties: Record<string, { type: string; format?: string; description: string }> };
      example: Record<string, string>;
    };
  };
};
const authOperation = (summary: string, description: string, requestBody?: AuthRequestBody) => ({
  tags: ["Better Auth account and session"],
  summary,
  description,
  ...(requestBody ? { requestBody } : {}),
  responses: { 200: { description: "Better Auth response." } },
});
const accountApiPaths = {
  "/api/auth/sign-up/email": {
    post: authOperation("Register with email and password", "Creates a Central Identity and sends an email verification message.", authRequest({
      name: { type: "string", description: "Placeholder display name." },
      email: { type: "string", format: "email", description: "Use a non-deliverable placeholder address." },
      password: { type: "string", format: "password", description: "Placeholder password; never use a real credential in this example." },
    }, ["name", "email", "password"], { name: "Placeholder Person", email: "person@example.invalid", password: "PLACEHOLDER_PASSWORD" })),
  },
  "/api/auth/sign-in/email": {
    post: authOperation("Sign in with email and password", "Starts a Central SSO Session for a verified Central Identity.", authRequest({
      email: { type: "string", format: "email", description: "Placeholder address only." },
      password: { type: "string", format: "password", description: "Placeholder password only." },
    }, ["email", "password"], { email: "person@example.invalid", password: "PLACEHOLDER_PASSWORD" })),
  },
  "/api/auth/send-verification-email": {
    post: authOperation("Send an email verification message", "Requests a verification message for the supplied email address.", authRequest({
      email: { type: "string", format: "email", description: "Placeholder address only." },
    }, ["email"], { email: "person@example.invalid" })),
  },
  "/api/auth/request-password-reset": {
    post: authOperation("Request a password reset", "Requests a password reset link. Use the local portal origin for redirectTo.", authRequest({
      email: { type: "string", format: "email", description: "Placeholder address only." },
      redirectTo: { type: "string", format: "uri", description: "Local password-reset page URL." },
    }, ["email", "redirectTo"], { email: "person@example.invalid", redirectTo: "http://localhost:8080/PLACEHOLDER_RESET_PATH" })),
  },
  "/api/auth/reset-password": {
    post: authOperation("Reset a password", "Sets a new password using a token from a password-reset message.", authRequest({
      token: { type: "string", description: "Placeholder reset token only." },
      newPassword: { type: "string", format: "password", description: "Placeholder password only." },
    }, ["token", "newPassword"], { token: "PLACEHOLDER_RESET_TOKEN", newPassword: "PLACEHOLDER_PASSWORD" })),
  },
  "/api/auth/get-session": {
    get: authOperation("Read the current session", "Returns the current Central SSO Session, or null when no valid session cookie is present."),
  },
  "/api/auth/list-sessions": {
    get: authOperation("List current identity sessions", "Lists sessions belonging to the authenticated Central Identity."),
  },
  "/api/auth/sign-out": {
    post: authOperation("End the current session", "Ends the session identified by the current session cookie."),
  },
  "/api/auth/revoke-session": {
    post: authOperation("Revoke a session", "Revokes the session identified by its token.", authRequest({
      token: { type: "string", description: "Placeholder session token only." },
    }, ["token"], { token: "PLACEHOLDER_SESSION_TOKEN" })),
  },
  "/api/auth/revoke-sessions": {
    post: authOperation("Revoke all sessions", "Revokes all sessions for the authenticated Central Identity."),
  },
};

const app = new Elysia()
  .use(openapi({
    enabled: openApiEnabled,
    documentation: {
      info: { title: "Central Identity local API", version: "1.0.0" },
      servers: [{ url: "/" }],
      paths: accountApiPaths,
    },
  }))
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
  })
  .onAfterHandle(({ request, response }) => {
    if (!(response instanceof Response)) return;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/auth/sign-in/email" || pathname === "/api/auth/sign-in/username") {
      console.info(JSON.stringify({
        event: response.ok ? "authentication.success" : "authentication.failure",
        action: "credential_sign_in",
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
  .get("/api/auth/config", () => Schema.decodeUnknownSync(configurationSchema)({ oauthEnabled }), {
    detail: {
      tags: ["Local API"],
      summary: "Read local authentication configuration",
      responses: { 200: { description: "Current Central Identity configuration.", content: { "application/json": { schema: jsonSchema(configurationSchema) } } } },
    },
  })
  .get("/api/auth/relying-party-destination", async ({ query, set }) => {
    const parsed = Schema.decodeUnknownEither(destinationQuerySchema)(query);
    if (parsed._tag === "Left") {
      set.status = 422;
      return Schema.decodeUnknownSync(destinationValidationSchema)({ type: "validation" });
    }
    const { client_id: clientId, redirect_uri: redirectUri } = parsed.right;
    const [client] = await db.select({
      disabled: oauthClient.disabled,
      redirectUris: oauthClient.redirectUris,
    }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
    if (!client || client.disabled || !client.redirectUris.includes(redirectUri)) {
      set.status = 400;
      return Schema.decodeUnknownSync(destinationResponseSchema)({ destination: null });
    }
    const destination = new URL(redirectUri);
    if (!allowedOAuthCallback(destination)) {
      set.status = 400;
      return Schema.decodeUnknownSync(destinationResponseSchema)({ destination: null });
    }
    return Schema.decodeUnknownSync(destinationResponseSchema)({ destination: destination.origin });
  }, {
    detail: {
      tags: ["Local API"],
      summary: "Resolve a registered Relying Party destination",
      description: "Returns the origin for an exact registered callback. Unknown, disabled, or unregistered callbacks return a null destination.",
      parameters: Object.entries(destinationQueryJsonSchema.properties ?? {}).map(([name, schema]) => ({
        name,
        in: "query" as const,
        required: destinationQueryJsonSchema.required?.includes(name) ?? false,
        description: schema.description,
        example: schema.examples?.[0],
        schema: schema as never,
      })),
      responses: {
        200: { description: "The registered callback origin.", content: { "application/json": { schema: jsonSchema(destinationResponseSchema) } } },
        400: { description: "The client or callback is not registered.", content: { "application/json": { schema: jsonSchema(destinationResponseSchema) } } },
        422: { description: "Query parameters do not match the documented schema.", content: { "application/json": { schema: jsonSchema(destinationValidationSchema) } } },
      },
    },
  })
  .get("/health/live", () => Schema.decodeUnknownSync(healthLiveSchema)({ status: "live" }), {
    detail: {
      tags: ["Local API"],
      summary: "Check process liveness",
      responses: { 200: { description: "The server process is live.", content: { "application/json": { schema: jsonSchema(healthLiveSchema) } } } },
    },
  })
  .get("/health/ready", async ({ set }) => {
    try {
      await databaseReady();
      return Schema.decodeUnknownSync(healthReadySchema)({ status: "ready" });
    } catch {
      set.status = 503;
      return Schema.decodeUnknownSync(healthReadySchema)({ status: "not_ready" });
    }
  }, {
    detail: {
      tags: ["Local API"],
      summary: "Check database readiness",
      responses: {
        200: { description: "Database is ready.", content: { "application/json": { schema: jsonSchema(healthReadySchema) } } },
        503: { description: "Database is not ready.", content: { "application/json": { schema: jsonSchema(healthReadySchema) } } },
      },
    },
  })
  .mount(auth.handler)
  .listen({ hostname: process.env.HOST ?? "0.0.0.0", port: Number(process.env.PORT ?? 3000) });

console.log(`Central Identity listening on ${app.server?.hostname}:${app.server?.port}`);
