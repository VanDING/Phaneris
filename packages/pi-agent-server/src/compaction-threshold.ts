import type { CompactionThreshold } from '@phaneris/shared/agent/compaction-threshold'
import { compact, convertToLlm, SettingsManager, type AgentSession, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import { effectiveCompactionReserve, isCompactionThreshold } from '@phaneris/shared/agent/compaction-threshold';

/** Public SDK settings + extension; no SDK/private-field or node_modules edits. */
export class CompactionThresholdController {
  private readonly baseline: SettingsManager;
  private threshold: CompactionThreshold = null;
  failure: string | undefined;

  constructor(settings: SettingsManager, private readonly session: () => AgentSession | undefined,
    private readonly writeReserve: (modelKey: string, reserveTokens: number) => Promise<void>) {
    this.baseline = SettingsManager.inMemory({ compaction: structuredClone(settings.getSettings().compaction ?? {}) });
  }

  async update(value: CompactionThreshold, model?: Pick<Model<any>, 'id' | 'provider' | 'contextWindow'>): Promise<void> {
    if (!isCompactionThreshold(value)) throw new Error('Invalid compaction threshold');
    if (model) {
      const original = this.baseline.getCompactionSettings(model);
      const reserveTokens = effectiveCompactionReserve(model.contextWindow, original.reserveTokens, value);
      await this.writeReserve(`${model.provider}/${model.id}`, reserveTokens);
    }
    this.threshold = value;
  }

  async refreshModel(model: Pick<Model<any>, 'id' | 'provider' | 'contextWindow'>): Promise<void> {
    await this.update(this.threshold, model);
  }

  install(pi: ExtensionAPI): void {
    pi.on('session_before_compact', async event => {
      this.failure = undefined;
      const session = this.session(), selected = session?.model;
      if (this.threshold === null) return;
      if (!session || !selected) return { cancel: true };
      const original = this.baseline.getCompactionSettings(selected);
      if (event.preparation.settings.reserveTokens === original.reserveTokens) return;
      try {
        if (event.signal.aborted) return { cancel: true };
        // The SDK reserves this catalog API id for virtual models. resolveModel
        // routes virtual entries only; physical custom endpoints go directly.
        const route = selected.api === 'pi-virtual' ? await session.modelRuntime.resolveModel(selected, convertToLlm(session.messages), {
          reason: 'direct', thinkingLevel: session.thinkingLevel, signal: event.signal,
        }) : { model: selected, thinkingLevel: session.thinkingLevel };
        const auth = await session.modelRuntime.getAuth(route.model, { signal: event.signal });
        if (event.signal.aborted || this.session() !== session) return { cancel: true };
        const model = auth?.auth.baseUrl ? { ...route.model, baseUrl: auth.auth.baseUrl } : route.model;
        const headers = auth?.auth.headers ? Object.fromEntries(Object.entries(auth.auth.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined;
        const result = await compact({ ...event.preparation, settings: { ...event.preparation.settings, reserveTokens: original.reserveTokens } },
          model, auth?.auth.apiKey, headers, event.customInstructions, event.signal, route.thinkingLevel,
          session.agent.streamFunction, auth?.env, session.settingsManager.getRetrySettings());
        if (event.signal.aborted || this.session() !== session) return { cancel: true };
        return { compaction: result };
      } catch (error) {
        if (!event.signal.aborted) this.failure = error instanceof Error ? error.message : String(error);
        // The SDK catches extension throws and would run its enlarged-budget
        // default. Explicit cancellation prevents that fallback; the host adds
        // this concrete failure to the terminal event/RPC instead.
        return { cancel: true };
      }
    });
  }
}
