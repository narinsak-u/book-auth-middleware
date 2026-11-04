import { createFileRoute } from "@tanstack/react-router";
import { ForgotPassword } from "../recovery";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPassword });
