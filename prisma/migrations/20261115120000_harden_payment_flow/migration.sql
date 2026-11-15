CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "preferenceId" TEXT,
    "providerOrderId" TEXT,
    "paymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProcessedPayment"
    ADD COLUMN "orderId" TEXT,
    ADD COLUMN "quantity" INTEGER,
    ADD COLUMN "amount" INTEGER,
    ADD COLUMN "currency" TEXT,
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE "User" ADD COLUMN "tokenDebt" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "PaymentOrder_preferenceId_key" ON "PaymentOrder"("preferenceId");
CREATE INDEX "PaymentOrder_providerOrderId_idx" ON "PaymentOrder"("providerOrderId");
CREATE UNIQUE INDEX "PaymentOrder_paymentId_key" ON "PaymentOrder"("paymentId");
CREATE INDEX "PaymentOrder_userId_status_createdAt_idx" ON "PaymentOrder"("userId", "status", "createdAt");
CREATE INDEX "ProcessedPayment_orderId_idx" ON "ProcessedPayment"("orderId");

ALTER TABLE "PaymentOrder"
    ADD CONSTRAINT "PaymentOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessedPayment"
    ADD CONSTRAINT "ProcessedPayment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
