// The mail accounts by id, for the account dot and label on every row, the reader and the sidebar.
import type {AccountOut, Colour} from '@setpoint/shared';
import {useEffect, useMemo, useState} from 'react';
import type {CSSProperties} from 'react';
import {useResource} from '../api/client.ts';
import {ACCOUNTS_PATH} from '../api/mail.ts';
import {accountColumn} from '../logic/inbox.ts';

export function useAccounts(): {list: AccountOut[]; byId: Map<number, AccountOut>} {
  const {data} = useResource<AccountOut[]>(ACCOUNTS_PATH);
  return useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => a.position - b.position);
    return {list, byId: new Map(list.map(account => [account.id, account]))};
  }, [data]);
}

/** A swatch as a colour: `var(--warm)`. */
export const colourVar = (colour: Colour | undefined) => (colour ? `var(--${colour})` : 'var(--ink3)');

/** The `--c` a dot reads its colour from. */
export const dotStyle = (colour: Colour | undefined) => ({'--c': colourVar(colour)}) as CSSProperties;

/**
 * The `--ac-w` the rows' account column takes: the longest label, measured in the rows' 12 px type
 * once the font has loaded (accountColumn).
 */
export function useAccountColumn(list: AccountOut[]): CSSProperties {
  const font = useMemo(() => `12px ${getComputedStyle(document.body).fontFamily}`, []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.load(font).then(() => live && setLoaded(true), () => {});
    return () => {
      live = false;
    };
  }, [font]);
  return useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return {};
    context.font = font;
    return {'--ac-w': `${accountColumn(list.map(account => context.measureText(account.label).width))}px`} as CSSProperties;
    // `loaded` measures again once the webfont is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, font, loaded]);
}
