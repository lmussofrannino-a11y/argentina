# Payment security rollout

The payment hardening requires these server-side environment variables in local development and every Vercel environment:

- `SESSION_SECRET`: a private random value of at least 32 bytes. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Do not commit or paste it into chat.
- `ADMIN_EMAIL`: the email of the account that is allowed to use the admin API. This must match a registered account.
- `MERCADO_PAGO_WEBHOOK_SECRET`: the signing secret configured for the Mercado Pago webhook. The webhook rejects notifications until this value is configured.
- `MERCADO_PAGO_ACCESS_TOKEN`: the existing server-side Mercado Pago access token.
- `NEXT_PUBLIC_BASE_URL`: the canonical HTTPS site URL in production.

The Prisma additions are additive: payment orders are stored separately, and new fields on `ProcessedPayment` are nullable/defaulted so existing processed-payment rows remain valid. The current `npm run build` runs `prisma db push` before generating the client; the SQL migration is also included for environments using Prisma Migrate.

Pending checkouts created before deployment remain verifiable only when Mercado Pago reports the exact existing catalog amount (ARS 3,000 or ARS 12,000) and the legacy user metadata/reference agree. The old client-provided quantity is not trusted.

New registrations store scrypt password hashes. Existing plaintext passwords are upgraded to scrypt after the account's next successful login, without changing the user's password. To migrate all existing rows at once, set the intended `DATABASE_URL` privately and run `npm run security:hash-legacy-passwords`; the script never prints passwords or hashes. Keep `SESSION_SECRET` stable; rotating it signs out all current sessions.

Full Mercado Pago refunds and chargebacks reverse the order's unspent token balance; any already-consumed amount becomes a token adjustment that future purchases settle before adding spendable tokens. Partial refunds are marked for manual reconciliation because token packs are indivisible.
