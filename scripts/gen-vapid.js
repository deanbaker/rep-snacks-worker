// Generates a VAPID key pair for Web Push.
// Writes .dev.vars (local) and vapid.secret.json (for `wrangler secret bulk`).
import { writeFileSync } from "node:fs";

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const raw = Buffer.from(await crypto.subtle.exportKey("raw", publicKey)).toString("base64url");

const secrets = { VAPID_PUBLIC_KEY: raw, VAPID_PRIVATE_JWK: JSON.stringify(jwk) };
writeFileSync("vapid.secret.json", JSON.stringify(secrets, null, 2));
writeFileSync(".dev.vars", Object.entries(secrets).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n");
console.log("Wrote vapid.secret.json and .dev.vars. Public key:", raw);
