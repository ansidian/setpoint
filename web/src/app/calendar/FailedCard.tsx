// A change that failed, in place (board 19b): a card anchored to the
// outlined chip saying what couldn't happen ("Failed to move Dinner with Sam"), where it was going and
// from ("Sat, Oct 10 · 7:00 – 9:00 PM", "From Fri, Oct 9"), the place and calendar, the provider and
// its own words, then Try again and Move back. Nothing quietly reverts: Move back is the user's.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {useState} from 'react';
import type {CSSProperties} from 'react';
import {detailWhen} from '../../logic/detail.ts';
import {failingWords} from '../../logic/health.ts';
import {failedFrom, failedTitle} from '../../logic/manipulate.ts';
import {placeLines} from '../../logic/place.ts';
import {PROVIDER_NAMES, splitProviderMessage} from '../../logic/providerWords.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';

// Under the provider's name, its trouble without it: "Down (scheduled maintenance).", or its own sentence.
// The provider's code, "409 Conflict", in the words' tip.
const codeOf = (message: string | null) => (message ? splitProviderMessage(message).code ?? undefined : undefined);
const failedWords = (message: string | null) => (message ? `${failingWords(message, null)}.` : 'It didn’t reach the provider.');


/** Move back's words for what it undoes. */
const BACK: Record<string, string> = {item_update: 'Move back', item_create: 'Discard', item_delete: 'Keep it', item_complete: 'Undo', item_reopen: 'Undo'};

interface FailedCardProps {
  item: ItemOut;
  calendar: CalendarOut | undefined;
  timeZone: string;
  onRetry: () => Promise<unknown>;
  onMoveBack: () => Promise<unknown>;
  onClose: () => void;
}

export function FailedCard({item, calendar, timeZone, onRetry, onMoveBack, onClose}: FailedCardProps) {
  const command = item.command!;
  const [busy, setBusy] = useState(false);
  const from = failedFrom(item, timeZone);
  const place = placeLines(item.place, item.address);
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  return (
    <>
      <div className="card-h">
        <span className="failed-mark"><Icon name="error" size={20} /></span>
        <span className="grow failed-title">{failedTitle(item)}</span>
        <button className="ibtn sm" aria-label="Close" data-tip="Close · Esc" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="card-b">
        <div className="fact"><Icon name="schedule" size={17} /><span className="num"><span className="v block">{detailWhen(item, timeZone)}</span>{from && <span className="ink3 from">{from}</span>}</span></div>
        {place && <div className="fact"><Icon name="location_on" size={17} /><span>{[place.name, place.address].filter(Boolean).join(' · ')}</span></div>}
        <div className="fact"><span className="cal-icon" style={{'--c': colourVar(item.colour ?? calendar?.colour ?? undefined)} as CSSProperties}><Icon name="calendar_today" size={17} /></span><span>{calendar?.name ?? 'Calendar'}</span></div>
        <div className="provider-says">
          <div className="ink3 provider">{command.provider ? PROVIDER_NAMES[command.provider] : 'Setpoint'}</div>
          <span data-tip={codeOf(command.provider_message)}>{failedWords(command.provider_message)}</span>
        </div>
        <div className="failed-acts">
          {command.can_retry && <button className="btn sm" disabled={busy} onClick={() => run(onRetry)}><Icon name="refresh" size={17} />Try again</button>}
          {command.can_move_back && <button className="btn out sm" disabled={busy} onClick={() => run(onMoveBack)}><Icon name="undo" size={17} />{BACK[command.kind] ?? 'Move back'}</button>}
        </div>
      </div>
    </>
  );
}
