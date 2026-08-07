import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_SECONDS = 10 * 60;

export const INSTAGRAM_REQUIRED_ENV = [
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "META_OAUTH_STATE_SECRET",
  "META_TOKEN_ENCRYPTION_KEY",
];

export function getInstagramConfiguration() {
  const missing = INSTAGRAM_REQUIRED_ENV.filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}

export function createMetaState(payload) {
  const secret = required("META_OAUTH_STATE_SECRET");
  const encoded = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function readMetaState(state) {
  const [encoded, signature] = String(state || "").split(".");
  if (!encoded || !signature) throw new Error("Ongeldige Meta-koppelcode.");
  const expected = createHmac("sha256", required("META_OAUTH_STATE_SECRET")).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("Ongeldige Meta-koppelcode.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("De Meta-koppelcode is verlopen.");
  return payload;
}

export function encryptMetaToken(token) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptMetaToken(record) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.token_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.token_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function encryptionKey() {
  const key = Buffer.from(required("META_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("META_TOKEN_ENCRYPTION_KEY moet een base64-sleutel van 32 bytes zijn.");
  return key;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ontbreekt.`);
  return value;
}


