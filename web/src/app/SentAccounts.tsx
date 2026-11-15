// Sent's header filter: All, then each account with its colour and label. An account with no sent
// mail reads quieter, and Tab and Shift-Tab pass over it, but a click still turns it on.
import type {AccountOut} from '@setpoint/shared';
import {Segmented} from '../ui/Segmented.tsx';
import {dotStyle} from './accounts.ts';

// All's segment. Accounts are their ids.
export const ALL_ACCOUNTS = 0;

/** `withMail`: the accounts with sent mail, or null until that's known (then none reads quiet). */
export function SentAccounts({accounts, withMail, value, onPick}: {
  accounts: readonly Pick<AccountOut, 'id' | 'label' | 'colour'>[];
  withMail: ReadonlySet<number> | null;
  value: number;
  onPick: (account: number) => void;
}) {
  return (
    <Segmented className="sent-accounts" label="Accounts" value={value} onChange={onPick} onTab={onPick} segments={[
      {value: ALL_ACCOUNTS, label: 'All'},
      ...accounts.map(one => {
        const quiet = withMail !== null && !withMail.has(one.id);
        return {value: one.id, quiet, tip: quiet ? 'Nothing sent' : undefined, label: <><span className="dot sm" style={dotStyle(one.colour)} />{one.label}</>};
      }),
    ]} />
  );
}
