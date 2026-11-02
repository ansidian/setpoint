// Browsers once kept the sidebar's account names and whether they were signed in, to draw the shell
// as Setpoint started. Nothing reads or writes these now, and only this would ever remove the names.
export function forgetShape() {
  try {
    localStorage.removeItem('setpoint.sidebar');
    localStorage.removeItem('setpoint.signedIn');
  } catch {
    // Private windows may refuse; the next start tries again.
  }
}
