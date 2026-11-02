import type { CompactionThreshold } from '@phaneris/shared/agent/compaction-threshold'
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import { effectiveCompactionReserve, isCompactionThreshold } from '@phaneris/shared/agent/compaction-threshold';

/** Pi 1.4+ reserves control the trigger only; the SDK owns summary generation. */
export class CompactionThresholdController {
  private readonly baseline: SettingsManager;
  private threshold: CompactionThreshold = null;

  constructor(settings: SettingsManager,
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

}
