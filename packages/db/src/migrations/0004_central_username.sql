ALTER TABLE "user" ADD COLUMN "username" text;
ALTER TABLE "user" ADD COLUMN "display_username" text;
CREATE UNIQUE INDEX "user_username_unique" ON "user" USING btree ("username");
