// Which adapter serves a source. Real sources go to their provider's adapter (none until B2 and B5
// add them); dev sources, and only dev sources, go to the dev provider.
import type {SourceProvider} from '@setpoint/shared';
import type {AdapterRegistry, SourceAdapter, SourceRow} from './adapter.ts';

export class Adapters implements AdapterRegistry {
  private readonly real: Partial<Record<SourceProvider, SourceAdapter>>;
  private readonly dev: SourceAdapter | null;

  constructor(real: Partial<Record<SourceProvider, SourceAdapter>> = {}, dev: SourceAdapter | null = null) {
    this.real = real;
    this.dev = dev;
  }

  adapterFor(source: SourceRow): SourceAdapter | null {
    if (source.dev) return source.credentials === null ? this.dev : null;
    return this.real[source.provider] ?? null;
  }
}
