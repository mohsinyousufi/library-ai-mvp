# PublicPass (Standalone)

PublicPass lets you securely share a logged‑in browser session with a friend using:
- A tiny Cloudflare Worker (stores only encrypted blobs + one‑time tokens)
- A Chrome extension (does all encryption/decryption on your device)

No servers to run. No plaintext on the backend. Links are single‑use.

## Quick start

1) Deploy the Worker
- Install Wrangler and log in:
```powershell
npm i -g wrangler
wrangler login
```
- Go to `serverless/` and deploy:
```powershell
cd serverless
wrangler kv:namespace create SHARES_KV
wrangler deploy
```
- Copy the Worker URL (e.g. `https://<name>.<account>.workers.dev`).

2) Lock CORS to your extension
- Load the extension once (see below) to learn its Extension ID.
- Set an env var for the Worker and redeploy:
```powershell
wrangler secret put ALLOWED_ORIGINS   # value: chrome-extension://<your_extension_id>
wrangler deploy
```

3) Install the extension
- In Chrome, open `chrome://extensions`, enable Developer mode, click “Load unpacked,” and choose the `chrome-extension/` folder.
- Open the extension’s Options page:
  - Server Base URL: paste your Worker URL
  - Your Username: pick a short name (letters/numbers/._-)
  - Save — the extension generates a keypair and registers your public key with the Worker.

4) Share a session
- Log into a site in a tab, click the extension, type your friend’s username, and click Share.
- Copy the one‑time link and send it to your friend.

5) Accept a session
- Friend installs the extension, sets their username (must match!), and opens your link.
- The extension decrypts, restores cookies + storage, opens a new tab, and consumes the token.

## Folders
- `chrome-extension/` — the Manifest V3 extension (background, popup, options, crypto)
- `serverless/` — Cloudflare Worker code and `wrangler.toml`
- `docs/` — architecture notes for the standalone design

Legacy Flask files have been removed; this repo now targets the Worker + Extension flow only.

## Troubleshooting
- Decrypt error or “Not found”: recipient username mismatch or the link was already used/expired
- Some cookies require HTTPS; ensure the target site opens on the same scheme/host you captured from
- Very large payloads: clear huge localStorage entries or try again after trimming data

## Security notes
- End‑to‑end: encryption happens in the extension using ECDH + HKDF + AES‑GCM
- Worker stores only ciphertext and one‑time tokens; consumption is enforced
- CORS is restricted to your extension ID
