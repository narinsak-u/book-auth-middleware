import { createFileRoute } from "@tanstack/react-router";
import { Portal } from "../portal";

export const Route = createFileRoute("/")({ component: () => <Portal mode="home" /> });
