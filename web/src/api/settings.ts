// Settings' resources and changes (shared/src/api/sources.ts, triage.ts and auth.ts have the
// routes). Each change shows its answer at once and refreshes what else it touches; secrets are
// write-only, so only whether one is set ever comes back.
import type {
  AccountOut, AuthMode, GmailAuthorizeOut, PlaceOut, ICloudConnectInput, NotificationOut, PasskeyOut, RecoveryCodesOut, RuleInput, RuleOut, SecretName,
  SecurityOut, Settings, SettingsPatch, TodoistConnectOut, TrustedDomainOut,
} from '@setpoint/shared';
import {ACCOUNTS_PATH} from './mail.ts';
import {withPatch} from '../logic/settings.ts';
import {getCached, getJson, refreshIfShown, sendJson, setCached, updateCached} from './client.ts';
import {SETTINGS_PATH} from './items.ts';

export const SOURCES_PATH = '/sources';
export const PRECISION_PATH = '/mail/precision';
export const RULES_PATH = '/mail/rules';
export const TRUSTED_PATH = '/mail/trusted-domains';
export const NOTIFY_STATUS_PATH = '/notifications/status';
export const AI_PATH = '/ai';
export const SECRETS_PATH = '/secrets';
export const SECURITY_PATH = '/security';

/** Changes some settings, shown at once; the answer is every setting (a refusal loads them again). */
export async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  if (getCached<Settings>(SETTINGS_PATH)) updateCached<Settings>(SETTINGS_PATH, settings => withPatch(settings, patch));
  let settings: Settings;
  try {
    settings = await sendJson<Settings>('PATCH', SETTINGS_PATH, patch);
  } catch (error) {
    refreshIfShown(SETTINGS_PATH);
    throw error;
  }
  setCached(SETTINGS_PATH, settings);
  // The models in use, and News's cap (Settings › AI's News group).
  if (patch.ai || patch.news) refreshIfShown(AI_PATH);
  if (patch.notifications) refreshIfShown(NOTIFY_STATUS_PATH);
  return settings;
}

// ---- Accounts and sources ----

export async function updateAccount(id: number, changes: Partial<Pick<AccountOut, 'label' | 'colour' | 'icon'>>): Promise<AccountOut> {
  updateCached<AccountOut[]>(ACCOUNTS_PATH, list => list.map(account => (account.id === id ? {...account, ...changes} : account)));
  try {
    const account = await sendJson<AccountOut>('PATCH', `/accounts/${id}`, changes);
    updateCached<AccountOut[]>(ACCOUNTS_PATH, list => list.map(one => (one.id === id ? account : one)));
    return account;
  } finally {
    refreshIfShown(ACCOUNTS_PATH);
  }
}

export async function reorderAccounts(ids: number[]): Promise<void> {
  updateCached<AccountOut[]>(ACCOUNTS_PATH, list => ids.map((id, position) => ({...list.find(account => account.id === id)!, position})));
  try {
    setCached(ACCOUNTS_PATH, await sendJson<AccountOut[]>('PUT', '/accounts/order', {account_ids: ids}));
  } finally {
    refreshIfShown(SOURCES_PATH);
  }
}

/** Connect Gmail, or Reconnect one Gmail account: Google's consent page to go to. */
export const authorizeGmail = (accountId?: number) => sendJson<GmailAuthorizeOut>('POST', '/accounts/gmail/authorize', accountId ? {account_id: accountId} : {});

export async function connectIcloud(input: ICloudConnectInput): Promise<AccountOut> {
  const account = await sendJson<AccountOut>('POST', '/accounts/icloud', input);
  refreshIfShown(ACCOUNTS_PATH);
  refreshIfShown(SOURCES_PATH);
  return account;
}

/** Check now: the source's scheduled check, at once; its health follows by the live stream. */
export const checkSource = (id: number) => sendJson<void>('POST', `/sources/${id}/check`);

/** A place with its coordinates (Home), closing the suggestions' session. */
export const findPlace = (placeId: string, session: string) => getJson<PlaceOut>(`/places/${encodeURIComponent(placeId)}?session_token=${encodeURIComponent(session)}`);

/** A source's own key (the weather's), write-only. */
export async function setSourceKey(id: number, key: string): Promise<void> {
  try {
    await sendJson<void>('PUT', `/sources/${id}/credentials`, {kind: 'api_key', key});
  } finally {
    refreshIfShown(SOURCES_PATH);
  }
}

/** Todoist's consent page to go to. */
export const connectTodoist = () => sendJson<TodoistConnectOut>('POST', '/todoist/connect');

// ---- Mail ----

export async function createRule(input: RuleInput): Promise<RuleOut> {
  const rule = await sendJson<RuleOut>('POST', RULES_PATH, input);
  refreshIfShown(RULES_PATH);
  return rule;
}

export async function deleteRule(id: number): Promise<void> {
  updateCached<RuleOut[]>(RULES_PATH, list => list.filter(rule => rule.id !== id));
  try {
    await sendJson<void>('DELETE', `/mail/rules/${id}`);
  } finally {
    refreshIfShown(RULES_PATH);
  }
}

export async function setRuleEnabled(id: number, enabled: boolean): Promise<void> {
  updateCached<RuleOut[]>(RULES_PATH, list => list.map(rule => (rule.id === id ? {...rule, enabled} : rule)));
  try {
    await sendJson<RuleOut>('PATCH', `/mail/rules/${id}`, {enabled});
  } finally {
    refreshIfShown(RULES_PATH);
  }
}

/** The written rules' new order. */
export async function reorderRules(ids: number[]): Promise<void> {
  updateCached<RuleOut[]>(RULES_PATH, list => [...ids.map((id, position) => ({...list.find(rule => rule.id === id)!, position})), ...list.filter(rule => !ids.includes(rule.id))]);
  try {
    await sendJson<RuleOut[]>('PUT', '/mail/rules/order', {rule_ids: ids});
  } finally {
    refreshIfShown(RULES_PATH);
  }
}

export async function untrustDomain(domain: string): Promise<void> {
  updateCached<TrustedDomainOut[]>(TRUSTED_PATH, list => list.filter(row => row.domain !== domain));
  try {
    await sendJson<void>('DELETE', `/mail/trusted-domains/${encodeURIComponent(domain)}`);
  } finally {
    refreshIfShown(TRUSTED_PATH);
  }
}

// ---- Notifications, AI keys ----

export async function sendTestNotification(): Promise<NotificationOut> {
  try {
    return await sendJson<NotificationOut>('POST', '/notifications/test');
  } finally {
    refreshIfShown(NOTIFY_STATUS_PATH);
  }
}

export async function setSecret(name: SecretName, value: string | null): Promise<void> {
  try {
    if (value === null) await sendJson<void>('DELETE', `/secrets/${name}`);
    else await sendJson<void>('PUT', `/secrets/${name}`, {value});
  } finally {
    refreshIfShown(SECRETS_PATH);
    refreshIfShown(AI_PATH);
  }
}


// ---- Security (each change needs the password confirmed in the last 10 minutes) ----

export async function confirmPassword(password: string): Promise<SecurityOut> {
  // A wrong password answers 401 too, which here isn't the session ending.
  const security = await sendJson<SecurityOut>('POST', '/security/confirm-password', {password}, {quiet401: true});
  setCached(SECURITY_PATH, security);
  return security;
}

const afterSecurityChange = () => refreshIfShown(SECURITY_PATH);

export async function changePassword(newPassword: string): Promise<void> {
  try {
    await sendJson<void>('PUT', '/security/password', {new_password: newPassword});
  } finally {
    afterSecurityChange();
  }
}

export async function setAuthMode(mode: AuthMode): Promise<void> {
  try {
    await sendJson<void>('PUT', '/security/auth-mode', {auth_mode: mode});
  } finally {
    afterSecurityChange();
  }
}

export async function regenerateRecoveryCodes(): Promise<string[]> {
  try {
    return (await sendJson<RecoveryCodesOut>('POST', '/security/recovery-codes')).recovery_codes;
  } finally {
    afterSecurityChange();
  }
}

/**
 * Adds a passkey: the server's options, the browser's ceremony (WebAuthn's own JSON forms, so no
 * encoding by hand), then the credential back to the server.
 */
export async function addPasskey(label: string): Promise<PasskeyOut[]> {
  try {
    const options = await sendJson<PublicKeyCredentialCreationOptionsJSON>('POST', '/security/passkeys/options', {label});
    const credential = await navigator.credentials.create({publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options)}) as PublicKeyCredential | null;
    if (!credential) throw new Error('No passkey was made.');
    return await sendJson<PasskeyOut[]>('POST', '/security/passkeys', {label, response: credential.toJSON()});
  } finally {
    afterSecurityChange();
  }
}

export async function deletePasskey(id: number): Promise<void> {
  try {
    await sendJson<void>('DELETE', `/security/passkeys/${id}`);
  } finally {
    afterSecurityChange();
  }
}
