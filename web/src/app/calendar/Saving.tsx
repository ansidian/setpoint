// A change on its way to its provider: the spinner, shown after a second. One its provider couldn't
// take for now shows the `warning` glyph in `caution` at once, why as its tip ("Todoist is down
// (scheduled maintenance) as of 7:26 PM"), while it waits to try again.
import type {CommandOut} from '@setpoint/shared';
import {retryingLine} from '../../logic/providerWords.ts';
import {Icon} from '../../ui/Icon.tsx';

export function Saving({command, timeZone, size}: {command: CommandOut | null | undefined; timeZone: string; size: number}) {
  const retrying = retryingLine(command, timeZone);
  if (retrying) return <span className="spin retrying" role="img" aria-label={retrying} data-tip={retrying}><Icon name="warning" size={size} /></span>;
  return <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={size} /></span>;
}
