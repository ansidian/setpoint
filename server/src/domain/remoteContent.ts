// Whether the reader loads an email's remote content (images, tracking pixels) by itself. It does
// for a trusted domain, and for a sender that passed DMARC when the email isn't Noise. Otherwise
// it's blocked behind "Images hidden · Show · Always
// show from contosocoffee.example".
import type {Lane, RemoteContentReason} from '@setpoint/shared';
import {getDomain} from 'tldts';

export interface RemoteContentInput {
  trusted: boolean;
  // The record's sender_authenticated: true passed, false failed or had no policy, null unknown.
  senderAuthenticated: boolean | null;
  // Null while Unsorted, which isn't Noise.
  lane: Lane | null;
}

export function remoteContent({trusted, senderAuthenticated, lane}: RemoteContentInput): {load: boolean; reason: RemoteContentReason} {
  if (trusted) return {load: true, reason: 'trusted'};
  if (senderAuthenticated === null) return {load: false, reason: 'unknown'};
  if (!senderAuthenticated) return {load: false, reason: 'not_authenticated'};
  if (lane === 'noise') return {load: false, reason: 'noise'};
  return {load: true, reason: 'authenticated'};
}

/**
 * What "Always show from …" trusts: the registrable domain by the public suffix list, so one click
 * covers a company's sending subdomains (news.contoso.com → contoso.com, mail.foo.co.uk → foo.co.uk).
 * A domain the list can't read (an IP, a bare name) is trusted as it is.
 */
export const trustDomainOf = (domain: string) => getDomain(domain, {allowPrivateDomains: true}) ?? domain;

/** A trusted domain covers its subdomains. Trusting contosocoffee.example shows mail from news.contosocoffee.example. */
export function isTrustedDomain(trusted: ReadonlySet<string>, domain: string): boolean {
  const labels = domain.toLowerCase().split('.');
  return labels.some((_, index) => trusted.has(labels.slice(index).join('.')));
}
