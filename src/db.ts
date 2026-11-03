import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "postgres://central:central@localhost:5432/central", {
  max: 10,
});

export const db = drizzle(client, { schema });
export const closeDatabase = () => client.end();
export const databaseReady = () => db.execute(sql`select 1`);
