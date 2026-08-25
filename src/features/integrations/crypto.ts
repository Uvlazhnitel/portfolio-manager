import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IntegrationProvider } from "@/lib/domain/enums";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;

export class IntegrationEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationEncryptionError";
  }
}

export function isIntegrationEncryptionConfigured(encodedKey = process.env.APP_ENCRYPTION_KEY) {
  if (!encodedKey?.trim()) return false;
  try {
    parseEncryptionKey(encodedKey);
    return true;
  } catch {
    return false;
  }
}

export function encryptIntegrationSecret(
  secret: string,
  provider: IntegrationProvider,
  encodedKey = process.env.APP_ENCRYPTION_KEY,
) {
  const key = parseEncryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(authenticatedData(provider)));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptIntegrationSecret(
  envelope: string,
  provider: IntegrationProvider,
  encodedKey = process.env.APP_ENCRYPTION_KEY,
) {
  try {
    const key = parseEncryptionKey(encodedKey);
    const [version, ivValue, tagValue, ciphertextValue, ...rest] = envelope.split(".");
    if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !ciphertextValue || rest.length > 0) {
      throw new Error("Invalid encrypted secret envelope.");
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(authenticatedData(provider)));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof IntegrationEncryptionError) throw error;
    throw new IntegrationEncryptionError("Stored integration key could not be decrypted.");
  }
}

function parseEncryptionKey(encodedKey: string | undefined) {
  if (!encodedKey?.trim()) {
    throw new IntegrationEncryptionError("APP_ENCRYPTION_KEY is not configured on the server.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey.trim())) {
    throw new IntegrationEncryptionError("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte value.");
  }
  const key = Buffer.from(encodedKey.trim(), "base64");
  if (key.length !== 32) {
    throw new IntegrationEncryptionError("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte value.");
  }
  return key;
}

function authenticatedData(provider: IntegrationProvider) {
  return `portfolio-manager:integration:${provider}:${ENVELOPE_VERSION}`;
}
