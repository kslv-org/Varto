# Varto web sharing

Adds `/share/` and `/share/auth/` to the existing static site. No build step, server, external script CDN, framework dependency, or new paid hosting is required. The landing, support and legal pages remain unchanged.

Open `https://www.varto.digital/share/?kind=wishlist&id=<uuid>` (kind may also be `profile` or `item`). Public pages load without login. Closed resources require an existing account with access; signing in does not grant access. Shop retains the full original URL. Open in Varto uses `varto://view/w|p|i/<uuid>` and requires the corresponding iOS update.

## Security and sessions

`share/config.js` contains only the project's public client URL/anon key, just like the native app. Never add service-role credentials, an OAuth secret, or user tokens. The database's read projection and Storage policies enforce access independently of JavaScript.

Email-code sign-in uses `create_user=false`. Google uses PKCE with a random verifier and ten-minute attempt lifetime. Tokens stay in this tab's sessionStorage; they are not put in URLs, HTML metadata, logs or persistent localStorage. Closing the tab ends browser persistence. Refresh verifies the current session; auth outages do not silently downgrade to anonymous. Sign-out clears the local session and requests local-session revocation.

Rendering uses DOM text nodes, validates Shop schemes and media paths, and decodes bounded raster blobs. No source HTML is inserted. CSP permits only this site's code/assets and the configured Supabase API; no inline code. Pages use no-referrer and generic, noindex social metadata. Private page content and blob URLs are cleared on background/BFCache entry and rechecked on return. Already viewed/downloaded data cannot be recalled. Generic social cards are intentional for this static first version.

## Checks

```sh
deno test tests/share_test.js
deno lint share tests
deno fmt --check share tests
```

Backend integration: in the backend checkout run `VARTO_SHARE_SITE=/path/to/this/checkout ruby tests/share-web/local.rb --run`. `tests/live-client.js` refuses a non-loopback database; its session fixtures must never be published.

## Publish prerequisites

- Backend migration `20261116131546_share_read_projection_v1.sql` applied to the intended Supabase project.
- The site's public config and CSP match that project.
- Exact Supabase Auth redirect `https://www.varto.digital/share/auth/` added without removing mobile callbacks.
- Test actual email delivery and Google login on the published origin. Apple-only accounts can use a working email code for their existing account; browser Apple OAuth is not configured in this change.
- Publish through the existing website workflow after review. No AASA/Universal Links setup is assumed for this GitHub Pages deployment; web links open in a browser, with an explicit Open in Varto action.

Do not claim publishing or production verification merely from local checks.

## Verified 2026-11-16

- 10 offline transport/URL/session tests; lint and format pass.
- Actual client against a fresh local Supabase: public, owner, member, stranger, decimal/URL preservation, permitted/denied media bytes.
- Actual Chrome at 390px: profile/list/item, decoded synthetic 64×64 PNG, closed page before login, local OTP verification to the owner's private list, reload, sign out and denial again. Screenshots are QA artifacts outside Git.
- Local Auth accepted a synthetic-user code generated through its local admin API; its default email template sent a magic link. Production email delivery/template and real Google callback were not reverified.
- No production deployment or Google/Supabase setting changes in this branch.
