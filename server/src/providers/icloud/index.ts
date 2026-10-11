// iCloud Mail: the IMAP adapter and Connect iCloud (an app-specific password, checked by logging in
// before it's stored).
import type {ICloudConnectInput} from '@setpoint/shared';
import {DEFAULT_SCHEDULES} from '../../domain/sources.ts';
import {SetpointError} from '../../errors.ts';
import type {Store} from '../../store.ts';
import {connectMailAccount} from '../../sync/connect.ts';
import type {Connected} from '../../sync/connect.ts';
import type {ICloudAdapter} from './adapter.ts';

export {ICloudAdapter, ICLOUD_IMAP, imapError} from './adapter.ts';
export type {ICloudAdapterOptions, ImapEndpoint} from './adapter.ts';

export interface ICloudConnector {
  connect(input: ICloudConnectInput): Promise<Connected>;
}

export function icloudConnector(store: Store, adapter: ICloudAdapter): ICloudConnector {
  return {
    async connect(input) {
      try {
        await adapter.verify(input.address, input.app_password);
      } catch (error) {
        const refused = error instanceof Error && 'kind' in error && error.kind === 'auth';
        throw new SetpointError(refused ? 'icloud_refused' : 'icloud_unreachable', refused
          ? 'iCloud refused that address and app password. Make a new app-specific password at appleid.apple.com and try again.'
          : `Couldn't reach iCloud: ${error instanceof Error ? error.message : String(error)}`, refused ? 400 : 502);
      }
      return connectICloud(store, input);
    },
  };
}

/** An iCloud account and its mail source, once its password is known to work (or comes from v1, src/importV1.ts). */
export function connectICloud(store: Store, input: ICloudConnectInput): Connected {
  const schedule = DEFAULT_SCHEDULES.icloud;
  return connectMailAccount(store, {
    provider: 'icloud', address: input.address, label: input.label ?? 'iCloud', colour: input.colour, icon: input.icon ?? 'cloud',
    credentials: {kind: 'app_password', username: input.address, password: input.app_password},
    syncMode: schedule.mode, intervalSeconds: schedule.intervalSeconds,
  });
}
