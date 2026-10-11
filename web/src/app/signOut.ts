// Sign out from ⌘K, Settings' nav or the phone asks once, in the toast: "Sign out of Setpoint? ·
// Sign out" (UX #21), as one stray Enter or click shouldn't end the session. Settings › Security's
// own Sign out, beside what it signs out of, doesn't ask.
import {signOut} from '../api/auth.ts';
import {showToast, toastFailure} from './toast.ts';

export const askSignOut = () => showToast('Sign out of Setpoint?', {label: 'Sign out', run: () => void signOut().catch(toastFailure('Couldn\'t sign out'))});
