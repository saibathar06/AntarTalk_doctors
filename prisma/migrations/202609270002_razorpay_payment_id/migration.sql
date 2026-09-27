ALTER TABLE "Payment" ADD COLUMN "providerPaymentId" VARCHAR(200);
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");
