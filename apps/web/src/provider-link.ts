export function confirmedLinkedProvider(
  providerHint: string | null,
  accounts: readonly { providerId: string }[] | null | undefined,
): "google" | "github" | undefined {
  if (
    (providerHint !== "google" && providerHint !== "github") ||
    !accounts?.some((account) => account.providerId === providerHint)
  ) return undefined;
  return providerHint;
}
