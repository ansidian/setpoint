// Paste the posting (DESIGN.md › The application's detail, #278; darma SV-140): the user's own copy of
// a posting, for one Jobs couldn't read or find. An inline area in the JD section rather than a modal,
// focused as it opens, with Save and Cancel. ⌘Enter saves and Esc cancels, going no further (Esc would
// close the pane). A refusal stays in place with the text, for another go.
import {MAX_PASTED_CHARS, PASTED_TOO_LONG} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import {ApiFailure} from '../../api/client.ts';

export function PastePosting({onSave, onCancel}: {onSave: (text: string) => Promise<unknown>; onCancel: () => void}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => area.current?.focus(), []);
  const save = () => {
    if (saving) return;
    // Told here, since a text past the API's own limit on a body wouldn't get as far as saying why.
    if (text.trim().length > MAX_PASTED_CHARS) return setRefused(PASTED_TOO_LONG);
    setRefused(null);
    setSaving(true);
    void onSave(text).catch((error: unknown) => {
      setRefused(error instanceof ApiFailure ? error.message : 'Setpoint couldn\'t send it.');
      setSaving(false);
      area.current?.focus();
    });
  };
  return (
    <div className="jb-paste">
      <textarea ref={area} className={refused ? 'input failed' : 'input'} aria-label="The posting's text" aria-invalid={refused !== null} aria-describedby={refused ? 'jb-paste-refused' : undefined}
        placeholder="The posting's text" value={text} onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          const saves = event.key === 'Enter' && (event.metaKey || event.ctrlKey);
          if (!saves && event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (saves) save();
          else onCancel();
        }} />
      {refused && <div className="refused" id="jb-paste-refused" role="alert">{refused}</div>}
      <div className="acts">
        <button className="btn sm" type="button" disabled={saving} onClick={save}>Save</button>
        <button className="btn quiet sm" type="button" onClick={onCancel}>Cancel</button>
        <span className="jb-hint">⌘Enter to save · Esc</span>
      </div>
    </div>
  );
}
