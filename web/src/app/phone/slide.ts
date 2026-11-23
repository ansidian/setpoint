// The phone's push and back for a page other than the Inbox (News's story): what it opens slides in
// over the list, which moves a little under it, and slides back off it, as one 260 ms view transition.
// phone.css draws it, by the direction on the root, and logic/phone.ts's phoneSlide says which way.
// The Inbox's reader has its own copy beside its list. Without the API it's a cut.
import {flushSync} from 'react-dom';

// The slide under way, so one that a newer one cut short doesn't take the newer one's direction away.
let slides = 0;

export function slide(direction: 'in' | 'back' | null, update: () => void) {
  if (!direction || !('startViewTransition' in document)) return update();
  const root = document.documentElement;
  const token = ++slides;
  root.dataset.slide = direction;
  void document.startViewTransition(() => flushSync(update)).finished.finally(() => {
    if (token === slides) delete root.dataset.slide;
  });
}
