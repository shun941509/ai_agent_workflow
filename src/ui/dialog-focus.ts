import type { KeyboardEvent } from 'react';

/** Keep sequential keyboard navigation in the active native dialog, including after its last control. */
export function cycleDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  const active = dialog.ownerDocument.activeElement;
  if (!active || active.closest('dialog') !== dialog) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert], details:not([open]) > :not(summary)')
      && el.closest('dialog') === dialog && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible');
  const stops = controls.filter(el => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
    const group = controls.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement
      && item.type === 'radio' && item.name === el.name && item.form === el.form);
    return el === (group.find(item => item.checked) ?? (event.shiftKey ? group.at(-1) : group[0]));
  });
  const first = stops[0], last = stops.at(-1);
  if (!first || !last || (active !== dialog && active !== (event.shiftKey ? first : last))) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
