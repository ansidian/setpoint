// The component tests' shared reads.

/** A colour as the page computes it: `var(--good)` or a `color-mix(…)`, on a probe. */
export function colour(value: string): string {
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.color = value;
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}
