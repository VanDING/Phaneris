/** Provider ids change independently of API ids and persisted connection/Vault keys. */
export function normalizePiProvider(provider: string): string {
  return provider === 'azure-openai-responses' ? 'azure' : provider;
}
