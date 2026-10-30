# Running Setpoint

The image, its settings, its data and its command line. Host details (hostnames, Nginx, backups,
deployment steps) live in the private ops workspace, not here.

## The image

One container runs one Node process. It serves the API, the live stream and the built web app from
one origin, and runs the sync engine beside them. The `Dockerfile` builds the web app in a first
stage and keeps only production dependencies in the second. Build it from a commit:

```sh
git archive --format=tar HEAD | docker build -t setpoint:$(git rev-parse --short HEAD) -
```

The process runs as `node` (uid 1000). It stops on SIGTERM, and `GET /health` answers Docker's
healthcheck.

## The data volume

`SETPOINT_DATA_DIR` (`/data` in the image) holds `setpoint.sqlite` and its WAL files. Mount it as a
volume writable by uid 1000. Migrations run at every start, inside a transaction. Back up the whole
directory. The encryption key must not live in it, so a backup alone can't open the credentials.

## Settings

All come from the environment. The image sets `NODE_ENV=production`, `SETPOINT_DATA_DIR=/data`,
`SETPOINT_WEB_DIR` and `SETPOINT_PORT=7430`.

| Variable | Meaning |
| --- | --- |
| `SETPOINT_KEY_FILE` or `SETPOINT_KEY` | The 256-bit key that seals credentials (64 hex characters or base64), as a file path or a value. Production refuses to start without one. |
| `SETPOINT_PUBLIC_URL` | Setpoint's own https origin. It makes the session cookie Secure, it is the passkeys' relying party (its hostname), and it is the base of OAuth callbacks, Calendar watch channels and ntfy's links. |
| `SETPOINT_WEBHOOK_ORIGIN` | Optional: the public https origin Google Calendar's watch channels post to, when the pages live on a private name (for example `https://hooks.example.com:8443`). Unset, channels use `SETPOINT_PUBLIC_URL` when that's https. A change re-registers the channels within one Calendar sync. |
| `SETPOINT_HOST` | The address to listen on. The default is `127.0.0.1`, which suits host networking. Use `0.0.0.0` when the host publishes the port, and publish it on the host's loopback only. |
| `SETPOINT_PORT` | The port to listen on (7430). |
| `SETPOINT_TZ` | The owner's time zone for local days (default `America/Los_Angeles`). |
| `SETPOINT_GOOGLE_CLIENT_ID`, `SETPOINT_GOOGLE_CLIENT_SECRET` | The Google OAuth client for Connect Gmail and Calendar, set both or neither. Its callback is `/api/ea/accounts/gmail/callback`. |
| `SETPOINT_GMAIL_PUBSUB_TOPIC`, `SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION`, `SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE` | Gmail push: the topic Gmail's watch publishes to, Setpoint's own pull subscription on it, and the service account key that pulls. Set all three or none. Without them, Gmail is polled every 2 minutes. |
| `SETPOINT_TODOIST_CLIENT_ID`, `SETPOINT_TODOIST_CLIENT_SECRET` | Todoist's OAuth app, set both or neither. Its callback is `/api/ea/accounts/todoist/callback`. Its webhook goes to `POST /api/todoist/webhook`, signed with this secret; a delivery only queues a Todoist sync, and polling every 5 minutes covers a webhook Todoist turned off. |
| `SETPOINT_WEB_DIR`, `SETPOINT_DATA_DIR` | Where the built web app and the data live (both set by the image). |

`SETPOINT_CLOCK` and `SETPOINT_DEV_AI_URL` are for development only, and production refuses them.
AI keys, the Maps key, ntfy and Home aren't environment settings: they are set in Settings, or
carried over from v1 by the import.

Two ways to run it behind the host's reverse proxy:

- **Host networking:** leave `SETPOINT_HOST` unset, and choose a `SETPOINT_PORT` that's free on the
  host.
- **A published port:** set `SETPOINT_HOST=0.0.0.0` and publish `127.0.0.1:<port>:7430`.

## The command line

Run it in the container (`docker exec <container> npm run cli -- <command>`, or
`node server/src/cli.ts <command>`), or in a one-off container with the same volume and settings.

| Command | What it does |
| --- | --- |
| `setup-token` | Prints a one-time token for the first claim, valid for an hour. |
| `status` | Shows whether Setpoint is claimed, and each source's health. |
| `ha-token` / `ha-token --revoke` | Issues, replacing any earlier one, or revokes Home Assistant's bearer token for `GET /api/status/ha`. |
| `import-v1 <file>` | Imports v1's export file once. `server/src/importV1.ts` documents the format. It's safe to run again. |
| `import-v1-triage <file>` | Imports only v1's triage rules and lane corrections. |
| `triage-history` | Starts or resumes the one-time model pass over backfilled mail, once an AI key is set. |
| `jobs-reread` / `jobs-reread --apply` | Lists what Jobs would read again now that it reads an email's HTML (SV-128), or does it: fills blank applications from their confirmations, then forgets the ignored emails that read differently and the ignored rejections so a history pass reads them. Safe to run again, and while the server runs. |
| `codes` / `codes --apply` | Lists sorted emails whose verification code would change if read again with the current detector, and the emails triage typed as code emails that have no code (likely misses), or writes those changes. Safe to run while the server runs. |

## Importing v1

v1's export script runs in v1's repository, with v1's own decryption, and writes one plaintext
JSON file. In order:

1. Make the key file, and set every variable above that's needed, before the import. Gmail
   accounts are imported as pushed only when Pub/Sub is set; otherwise they're polled.
2. Stop Setpoint. Run the import in a one-off container with the data volume, the key file, the
   same environment, and the export file mounted read-only from outside the data volume, so no backup
   ever holds it:
   `docker run --rm --env-file <env> -v <data>:/data -v <export>:/import/v1.json:ro <image> node server/src/cli.ts import-v1 /import/v1.json`
3. Read the report. It lists what was imported, what was skipped and why, and what to do
   afterwards. It never prints a secret.
4. Delete the export file.
5. Start Setpoint and sign in with v1's password. On an unclaimed database the import is the claim:
   v1's password and unused recovery codes carry over. v1's passkeys work only where Setpoint serves
   v1's hostname.
6. The backfill rebuilds the mail index, and the calendar and Todoist mirrors sync from their
   providers. Pins land as their emails arrive. When the backfill is done, run `triage-history`.
7. Reconnect each Google account once in Settings › Accounts. Tokens from v1 carry v1's scopes, so
   calendar colour changes are refused until then. Everything else works without it.

Running the import again fills only what's missing. It never overwrites a sign-in, key, model,
Home or password that v2 already has.
