# Standalone PublicPass Session Share Architecture

This document describes the fully standalone Chrome extension experience. Users install the extension only—no self-hosted server. All heavy lifting is provided by a multi-tenant, serverless backend the project owner deploys once (e.g. on Cloudflare Workers) and the extension talks to when sharing sessions.

## High-level objectives

1. **Zero-setup for end users** – installing the CRX/ZIP is enough; the backend is hosted centrally.
2. **End-to-end confidentiality** – plaintext session data never leaves the browser. The worker stores only encrypted blobs.
3. **Recipient targeting** – users pick a username; a long-term public key allows others to encrypt sessions to them.
4. **One-time delivery** – shared sessions self-destruct after a single successful acceptance or when TTL expires.
5. **Secure auto-login** – the extension injects cookies/localStorage into the destination origin and opens the tab already authenticated.

## System components

### Chrome extension (Manifest V3)

- **Background service worker (`background.js`)**
   - Generates/loads the user’s asymmetric key pair (WebCrypto ECDH P-256).
   - Registers the public key with the worker backend and performs authenticated fetches.
   - Collects cookies/storage, encrypts payloads, uploads shares, and consumes them.
   - Listens for navigation to `session/<token>` pages to trigger acceptance.
- **Popup UI (`popup/*`)**
   - Allows sharing the current tab’s session with a recipient username and optional comment.
   - Displays the one-time link and recent share status.
- **Options UI (`options/*`)**
   - Lets users set their username, override the backend endpoint (for staging), and reset keys.
- **Content scripts**
   - `content/capture.js` runs in the sender tab to read `localStorage` / `sessionStorage`.
   - `content/inject.js` (inlined via scripting API) writes storage keys when a session is accepted.
- **Crypto helper (`lib/crypto.js`)**
   - Wraps WebCrypto for ECDH key generation/export/import, HKDF key derivation, AES-GCM encryption, plus gzip compression.

### Managed backend (Cloudflare Worker)

- **HTTP API** (`/v1/...`)
   - `POST /v1/users/:username`: register or update a user’s public key (first-claim or signed update).
   - `GET /v1/users/:username`: retrieve public key for encryption.
   - `POST /v1/shares`: store a compressed cipher bundle, comment, metadata, TTL.
   - `GET /v1/shares/:token`: fetch an unconsumed share (cipher only).
   - `POST /v1/shares/:token/consume`: mark the share consumed and delete storage.
- **Storage**
   - Durable Object maintains share metadata, consumption state, and rate limiting.
   - KV stores encrypted payloads and user public keys.
- **Security controls**
   - Requires HTTPS. CORS is locked to `chrome-extension://<extension-id>`.
   - Enforces payload size limits, TTL bounds, and per-IP rate limits.
   - Optional bot protection (e.g. Cloudflare Turnstile) can be injected on share creation.

## Data & crypto flow

1. **Registration**
    - On first launch, the extension generates an ECDH P-256 key pair.
    - Public JWK is uploaded with chosen username. Private key (JWK) stays in `chrome.storage.local`.
2. **Share creation**
    - Popup asks the background to share the active tab.
    - Background collects cookies and storage, normalizes them into a payload, compresses with gzip.
    - Looks up recipient public key via `GET /v1/users/:username`.
    - Derives a symmetric key using ECDH + HKDF, encrypts payload with AES-GCM (256-bit).
    - Sends `POST /v1/shares` containing the cipher, metadata, and optional comment.
   - Worker returns a one-time HTTPS link (e.g. `https://publicpass.example/session/<token>`); the extension shows/copies it.
3. **Share acceptance**
    - Recipient opens the link. The background detects navigation to `…/session/<token>`.
    - Background fetches the cipher, decrypts using its private key, and validates the embedded target origin/path.
    - Opens a new tab to that origin, applies cookies (`chrome.cookies.set`), injects storage via scripting, and optionally reloads.
    - Notifies the worker to consume (delete) the share.
4. **Replay prevention**
    - Durable Object ensures only one consumption call succeeds. Subsequent fetches get 404/410.
    - Token entropy ≥160 bits; tokens expire automatically (KV TTL + DO cron cleanup).

## Permissions & constraints

- Extension requests `cookies`, `storage`, `scripting`, `tabs`, `activeTab`, `notifications`, `webNavigation`.
- Host permissions are requested per-site using the `originPermissions` API (Chrome 116+) or by prompting on first use.
- Only cookies for the relevant domain/path are enumerated; Secure cookies are written only on HTTPS origins.
- IndexedDB cannot be cloned; document this limitation clearly.

## Error handling & UX

- Background catches API failures and surfaces them via notifications and popup status.
- If recipient username is unregistered, share creation fails with a helpful error.
- Acceptance prompts user if target origin is different from captured origin before injecting.
- Users can reset keys (generates new key pair, updates backend, clears old shares).

## Deployment overview

- **Backend**
   - `serverless/worker.js` contains the Cloudflare Worker script. Deploy with `wrangler publish`.
   - Requires KV namespaces `USERS_KV`, `SHARES_KV` and a Durable Object `ShareManager` binding.
   - Set environment variables: `ALLOWED_ORIGINS`, `DEFAULT_TTL`, `MAX_TTL`, `MAX_PAYLOAD_BYTES`, `TURNSTILE_SECRET` (optional).
- **Extension packaging**
   - Build CRX or zip `chrome-extension/` and share manually.
   - Options page defaults to the production worker URL but still allows overrides for staging.

## Testing checklist

- Pairwise manual test between two Chrome profiles, verifying cookies + storage injection.
- Large session scenario (e.g. multiple cookies, large localStorage) to confirm compression/limit handling.
- Username rotation/resync flow.
- Multi-consume protection (second open should fail with 404).
- Optional Turnstile or rate-limiting behavior under repeated POSTs.

This architecture keeps the experience turnkey for end users while ensuring the session material remains encrypted end-to-end.
