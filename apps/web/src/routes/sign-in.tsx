import { createFileRoute } from "@tanstack/react-router";
import { Portal } from "../portal";

export const Route = createFileRoute("/sign-in")({ component: () => <Portal mode="sign-in" /> });
