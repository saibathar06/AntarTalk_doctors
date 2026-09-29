ALTER TABLE "VideoCall"
  ADD COLUMN "doctorJoinedAt" TIMESTAMPTZ(3),
  ADD COLUMN "clientJoinedAt" TIMESTAMPTZ(3),
  ADD COLUMN "concurrentSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attendanceFinalizedAt" TIMESTAMPTZ(3);

ALTER TABLE "VideoCall"
  ADD CONSTRAINT "VideoCall_concurrentSeconds_check" CHECK ("concurrentSeconds" >= 0);

CREATE INDEX "VideoCall_attendanceFinalizedAt_closesAt_idx"
  ON "VideoCall"("attendanceFinalizedAt", "closesAt");
