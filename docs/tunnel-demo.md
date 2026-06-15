# Tunnel demo — let a remote person edit a notebook

Prove the relay-as-edit-transport path: someone on another machine opens a link
and co-edits a notebook live. Sync goes through the relay (not the local file),
so the remote peer needs no repo, no checkout, and no dev server of their own.

## How it fits together

One tunnel, one origin. The Vite dev server proxies the relay under `/__relay`
(`vite.config.ts`), so a single public URL carries everything:

```
remote browser ──https──▶ ngrok ──▶ localhost:5180 (Vite)
                                     ├─ /              the app (SDUI renderer)
                                     ├─ /__relay  ───▶ localhost:8787  relay (ws + http)
                                     ├─ /__data        SQL over data/events.db
                                     └─ /__editor       editor API (local editing only)
```

The remote peer renders the notebook from the relay's block tree (`RenderDoc`)
and edits emit protocol ops over `/__relay`. The host keeps the file; the relay
keeps the live doc. (Wiring the relay's edits back into the `.tsx` file is the
next step — see `plans/publish-share-deploy.html`, change E.)

## Run it

Three processes:

```sh
# 1) the relay
cd ../react-collab && npm run dev          # :8787

# 2) the app (proxies /__relay → :8787)
npm run dev                                # :5180

# 3) the public URL
npm run tunnel                             # ngrok http 5180
```

Then:

1. Open the app locally (`http://localhost:5180`), pick a page, click **Share**.
   You land on `/<slug>?room=<id>` — you're in the room.
2. Copy that URL but swap the host for the tunnel host, e.g.
   `https://<your-tunnel>.ngrok-free.dev/<slug>?room=<id>`, and send it.
   (Or just open the app *through* the tunnel and click Share there — the link
   it copies already uses the tunnel origin.)
3. The other person opens it, lands in the same room, and edits. Text, SQL
   (with the query re-running against the shared dataset), and insert/delete all
   sync both ways.

## Notes / caveats

- **ngrok free** shows a one-time interstitial ("You are about to visit…") per
  visitor; click **Visit Site** once. `cloudflared tunnel --url http://localhost:5180`
  has no interstitial and needs no account if you prefer it.
- **The host machine is the source of truth** for this demo — it runs the relay,
  the dataset, and the build. If it sleeps, the room goes away (rooms are
  in-memory). Persistence + a hosted query backend are the D1 rung.
- **Auth**: the room id is the only gate right now (unguessable, but open).
  SSO / access control is the D2 rung.
