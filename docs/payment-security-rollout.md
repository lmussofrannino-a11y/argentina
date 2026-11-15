# Payment security rollout

The payment integration requires these server-side environment variables in local development and Vercel:

- `SESSION_SECRET`: a private random value of at least 32 bytes. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Do not commit or paste it into chat.
- `ADMIN_EMAIL`: the email of the account that is allowed to use the admin API. This must match a registered account.
- `MERCADO_PAGO_ORDERS_ACCESS_TOKEN`: the production/test Access Token from the new Checkout Pro application configured for the Orders API.
- `MERCADO_PAGO_ORDERS_WEBHOOK_SECRET`: the signing secret from that application's Webhooks configuration for the `Order (Mercado Pago)` / `orders_v2` event.
- `MERCADO_PAGO_ACCESS_TOKEN` and `MERCADO_PAGO_WEBHOOK_SECRET`: retain the old Preferences credentials while legacy checkouts are still being reconciled.
- `NEXT_PUBLIC_BASE_URL`: the canonical HTTPS site URL in production.

Create the new Mercado Pago application as **Checkout Pro → API de Orders**. The new checkout route creates `/v1/orders`, redirects to its `checkout_url`, and uses the app-level `Order (Mercado Pago)` webhook. The old Preferences route and credentials remain available only for orders created before the switch.

Configure the new app's Webhooks separately for test and production, using the `Order (Mercado Pago)` event and `https://<site-domain>/api/mercadopago/verify-payment`. In Vercel Preview, set `MERCADO_PAGO_ORDERS_ACCESS_TOKEN` and `MERCADO_PAGO_ORDERS_WEBHOOK_SECRET` to the new app's test credentials/signature. Keep Production on its existing credentials until Preview has passed; then set the new app's production credentials in the same two variable names for Production. Do not replace the legacy variables until pending Preferences orders have been reconciled.

The Prisma additions are additive: the provider's order ID is nullable and indexed, so existing payment rows remain valid. The current `npm run build` runs `prisma db push` before generating the client; the SQL migration is also included for environments using Prisma Migrate.

Pending checkouts created before deployment remain verifiable only when Mercado Pago reports the exact existing catalog amount (ARS 3,000 or ARS 12,000) and the legacy user metadata/reference agree. The old client-provided quantity is not trusted.

New registrations store scrypt password hashes. Existing plaintext passwords are upgraded to scrypt after the account's next successful login, without changing the user's password. To migrate all existing rows at once, set the intended `DATABASE_URL` privately and run `npm run security:hash-legacy-passwords`; the script never prints passwords or hashes. Keep `SESSION_SECRET` stable; rotating it signs out all current sessions.

Full Mercado Pago refunds and chargebacks reverse the order's unspent token balance; any already-consumed amount becomes a token adjustment that future purchases settle before adding spendable tokens. Partial refunds are marked for manual reconciliation because token packs are indivisible.
