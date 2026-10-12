// Check now (SV-25, D54), on Settings › Accounts' rows and, since the polish audit's states-08, on the
// Inbox's and the calendar pane's stale and failing lines, where a problem is noticed.
import type {HealthOut} from '@setpoint/shared';
import {useEffect, useState} from 'react';
import {refresh} from '../../api/client.ts';
import {checkSource} from '../../api/settings.ts';
import {failureLine} from '../toast.ts';

/** How long "Checking…" waits for the source's health to move on before it lets go. */
const CHECK_WAIT_MS = 15_000;

/**
 * Check now on a source: its line reads "Checking…" from the click until the source's health moves
 * on, asking `path` (where that health comes from) again each second for up to 15 s, or why the
 * check couldn't start.
 */
export function useCheckNow(source: {id: number; health: HealthOut} | undefined, path: string) {
  const [check, setCheck] = useState<{from: string} | {failed: string} | null>(null);
  const health = JSON.stringify(source?.health ?? null);
  const checking = check !== null && 'from' in check && check.from === health;
  useEffect(() => {
    if (!checking) return;
    // The server sends a health event only when a state changes, so a check that stays healthy is asked after.
    const poll = window.setInterval(() => void refresh(path), 1000);
    const stop = window.setTimeout(() => setCheck(null), CHECK_WAIT_MS);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [checking, path]);
  const failed = check !== null && 'failed' in check ? check.failed : null;
  return {
    text: checking ? 'Checking…' : failed,
    checking,
    failed: failed !== null,
    run: () => {
      if (!source) return;
      setCheck({from: health});
      void checkSource(source.id).catch((error: unknown) => setCheck({failed: failureLine('Couldn\'t check', error)}));
    },
  };
}
