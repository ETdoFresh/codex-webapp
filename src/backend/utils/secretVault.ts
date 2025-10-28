import crypto from "node:crypto";

const SECRET_ENV_KEY = "CODEX_WEBAPP_SECRET";

type EncryptedPayload = {
  cipherText: string;
  iv: string;
  tag: string;
};

const getSecretKey = (): Buffer | null => {
  const secret = process.env[SECRET_ENV_KEY];
  if (!secret || secret.trim().length === 0) {
    return null;
  }

  if (/^[0-9a-fA-F]{64}$/.test(secret.trim())) {
    return Buffer.from(secret.trim(), "hex");
  }

  return crypto.createHash("sha256").update(secret.trim()).digest();
};

export const isEncryptionAvailable = (): boolean => getSecretKey() !== null;

export const encryptSecret = (value: string): EncryptedPayload | null => {
  const key = getSecretKey();
  if (!key) {
    console.warn(
      "[codex-webapp] CODEX_WEBAPP_SECRET not set; storing Dokploy API key without encryption.",
    );
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
};

export const decryptSecret = (
  cipherText: string | null,
  iv: string | null,
  tag: string | null,
): string | null => {
  if (!cipherText) {
    return null;
  }

  const key = getSecretKey();
  if (!key || !iv || !tag) {
    return Buffer.from(cipherText, "base64").toString("utf8");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};
