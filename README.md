# Mobile Shop Manager

Static shop-management app hosted on Vercel, with Supabase email/password authentication and cloud persistence.

- Project: `ayzwhavgzzxkosggwgkq` (`mobile-shop-manager`).
- Each authenticated user owns one isolated workspace, including its branches. There is no cross-account platform administrator or employee invitation system.
- Inventory, sales, repairs, expenses, Whish records and branch settings persist in `public.shop_workspaces.payload` (JSONB). RLS isolates by `auth.uid()`; the primary key is indexed.
- `save_shop_workspace` performs an atomic revision check and uses a request ID for idempotent retry. Concurrent conflicting saves are blocked instead of silently overwriting another device.
- The app refreshes changes every 15 seconds and on window focus, except while editing a modal or building a sale. Refresh is also available manually.
- Green “Saved to cloud” is the authoritative save confirmation. Unsaved drafts are kept per user on the same browser. Network failures/conflicts show a blocking dialog with retry, download and load-cloud choices.
- Old local data is never uploaded automatically. After login on the old browser, use “Import old browser data”, or restore an exported JSON backup. This explicitly replaces the signed-in account’s workspace.
- PIN/demo shortcuts no longer authenticate. Supabase manages passwords. The publishable key is intentionally public; no service-role or secret key is shipped.

## Deployment

Vercel serves the repository as a static site (framework: Other). `vendor/supabase-2.57.4.js` is the pinned SDK distribution from `@supabase/supabase-js@2.57.4`; its license is included. After changing the dependency, recopy `node_modules/@supabase/supabase-js/dist/umd/supabase.js` and update HTML/service-worker references.

In Supabase Authentication → URL Configuration, set Site URL to `https://mobile-shop-manager-mu.vercel.app/` and allow that exact URL as a redirect. Confirmation and password-reset flows use it. Keep email confirmation enabled. Configure a production SMTP provider before onboarding external customers: the default Supabase sender has recipient and rate restrictions. No SMTP service has been configured by this code change.

`database.sql` records the schema applied to the linked project. It is an initial schema, not an idempotent script to rerun on existing tables.

## Verification

`npm ci && npm test` exercises the real application DOM with a mocked Supabase transport: startup, saves, offline draft recovery, concurrent revision conflict, logout and disabled PIN shortcuts. Database isolation and idempotency were separately tested in a rolled-back SQL transaction against the linked project. No test accounts or business data were retained.

## Scope

This preserves the existing single-workspace app model. Full workspace snapshots have a 10 MB save limit. For heavy concurrent cashiers or large histories, migrate to normalized per-record transactional tables. Existing financial calculations are unchanged; this integration does not audit their accounting correctness. Offline first-time sign-in is unavailable.
