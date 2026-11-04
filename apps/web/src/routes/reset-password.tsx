import { createFileRoute } from "@tanstack/react-router";
import { ResetPassword } from "../recovery";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });
