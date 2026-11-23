// The phone Agenda's way back to today, for the tab bar (Phone.tsx): a tap on the Agenda tab while
// it shows takes the agenda to today, which sits under the past week rather than at the top.
let toToday: (() => void) | null = null;

/** The mounted Agenda's. */
export function onAgendaToday(go: () => void): () => void {
  toToday = go;
  return () => {
    if (toToday === go) toToday = null;
  };
}

/** Takes the agenda on screen to today; false with none on screen. */
export function agendaToToday(): boolean {
  toToday?.();
  return toToday !== null;
}
