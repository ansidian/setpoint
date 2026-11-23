// A random v4 UUID, such as the session token Google's place search groups one search's requests by.
// It's crypto.getRandomValues', not crypto.randomUUID: browsers offer randomUUID only on a secure page
// (https or localhost), and the dev Setpoint on the LAN (npm run try -- --lan) is plain http, where
// Safari has none and the editor would throw as it opens.

export function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
