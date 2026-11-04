import { createFileRoute } from "@tanstack/react-router";
import { Enrollment } from "../portal";

export const Route = createFileRoute("/sign-up")({ component: Enrollment });
