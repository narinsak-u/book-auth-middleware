import { expect, test } from "bun:test";
import { confirmedLinkedProvider } from "./provider-link";

test("a provider-link query hint alone never confirms a linked account", () => {
  expect(confirmedLinkedProvider("google", undefined)).toBeUndefined();
  expect(confirmedLinkedProvider("google", [{ providerId: "github" }])).toBeUndefined();
});
