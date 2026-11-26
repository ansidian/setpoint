// An email's quoted history, folded behind •••, as Gmail folds it. The button shows it again and
// folds it back. A plain-text email's history is the children (logic/quoted.ts finds it). An HTML
// email's is in its frame, so the reader holds `open` itself and loads the frame's full page when
// it opens, with no children here. While find searches the email, a folded history carries the
// count of its matches (`find`), and find opens it to reach one (search/find.ts).
import {useState} from 'react';
import type {ReactNode} from 'react';

export function QuotedHistory({open, onToggle, find, children}: {open?: boolean; onToggle?: (open: boolean) => void; find?: {key: string; count: number}; children?: ReactNode}) {
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const toggle = () => {
    setOwn(!shown);
    onToggle?.(!shown);
  };
  return (
    <div className="quoted" data-find-hidden={find && !shown ? find.key : undefined} data-find-count={find && !shown ? find.count : undefined}>
      <button type="button" className="btn ghost sm" aria-expanded={shown} aria-label={shown ? 'Hide quoted text' : 'Show quoted text'} onClick={toggle}>•••</button>
      {shown && children}
    </div>
  );
}
