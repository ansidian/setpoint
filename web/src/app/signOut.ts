// Sign out from ⌘K, Settings' nav or the phone asks once, in the toast: "Sign out of Setpoint?" with
// Cancel and Sign out, waiting for an answer, as one stray Enter or click shouldn't end the session. Settings › Security's
// own Sign out, beside what it signs out of, doesn't ask.
import {signOut} from '../api/auth.ts';
import {showConfirm, toastFailure} from './toast.ts';

export const askSignOut = () => showConfirm('Sign out of Setpoint?', {label: 'Sign out', run: () => void signOut().catch(toastFailure('Couldn\'t sign out'))});
