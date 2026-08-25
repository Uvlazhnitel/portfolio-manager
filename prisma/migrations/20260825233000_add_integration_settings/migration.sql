CREATE TYPE "IntegrationProvider" AS ENUM ('OPENAI', 'COINGECKO');

CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encryptedApiKey" TEXT,
    "apiKeySuffix" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationSetting_secret_pair_check" CHECK (
      ("encryptedApiKey" IS NULL AND "apiKeySuffix" IS NULL)
      OR
      ("encryptedApiKey" IS NOT NULL AND "apiKeySuffix" IS NOT NULL AND char_length("apiKeySuffix") BETWEEN 1 AND 4)
    )
);

CREATE UNIQUE INDEX "IntegrationSetting_provider_key" ON "IntegrationSetting"("provider");
