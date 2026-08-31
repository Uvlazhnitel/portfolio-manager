CREATE TYPE "AssistantMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "AssistantMessage"
ADD COLUMN "status" "AssistantMessageStatus" NOT NULL DEFAULT 'COMPLETED';

WITH ordered_messages AS (
    SELECT
        "id",
        "role"::text AS "role",
        LEAD("role"::text) OVER (
            PARTITION BY "conversationId"
            ORDER BY "createdAt", "id"
        ) AS "nextRole"
    FROM "AssistantMessage"
)
UPDATE "AssistantMessage" AS message
SET "status" = 'FAILED'
FROM ordered_messages AS ordered
WHERE message."id" = ordered."id"
  AND ordered."role" = 'USER'
  AND ordered."nextRole" IS DISTINCT FROM 'ASSISTANT';

CREATE INDEX "AssistantMessage_conversationId_status_createdAt_idx"
ON "AssistantMessage"("conversationId", "status", "createdAt");
