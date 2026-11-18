-- Existing rows keep NULL: historically they represent an already credited pack.
-- New reversal/review tombstones use 0 and must never remove uncredited tokens.
ALTER TABLE "ProcessedPayment" ADD COLUMN "creditedQuantity" INTEGER;

CREATE TABLE "PaymentReconciliationIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'retry',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PaymentReconciliationIssue_status_updatedAt_idx" ON "PaymentReconciliationIssue"("status", "updatedAt");

ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentOrder"
  ADD COLUMN "checkoutUrl" TEXT,
  ADD COLUMN "creationState" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN "creationStartedAt" TIMESTAMP(3);
ALTER TABLE "PaymentOrder" ADD COLUMN "creationPayload" JSONB;
CREATE TABLE "RevokedSession" ("id" TEXT NOT NULL PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
CREATE TABLE "RateLimitBucket" ("id" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL, "resetAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- NOT VALID preserves historical rows requiring reconciliation while enforcing
-- non-negative balances for subsequent inserts/updates. Apply via Prisma Migrate;
-- db push alone does not install CHECK constraints.
ALTER TABLE "User" ADD CONSTRAINT "User_tokens_non_negative" CHECK ("tokens" >= 0) NOT VALID;
ALTER TABLE "User" ADD CONSTRAINT "User_tokenDebt_non_negative" CHECK ("tokenDebt" >= 0) NOT VALID;
