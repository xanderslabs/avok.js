// One-off harness to produce a real end-to-end proving input for circuits/jwt-recovery: a real
// RSA-2048/RS256-signed JWT, its noir-jwt circuit inputs, and the three public inputs
// (pubkeyHash, identity, nonceBinding) computed exactly as src/main.nr computes them in-circuit
// -- so a real `bb prove` / `bb verify` / on-chain `verify()` run demonstrates the whole pipeline,
// not just that the circuit compiles. Not part of the deploy path; a dev tool run once to produce
// Prover.toml + expected-public-inputs.json for the sprint's proof-of-life run.
import { createRequire } from "node:module";
import { generateKeyPairSync, createSign } from "node:crypto";
import { keccak256, toBytes } from "viem";

// viem's toHex(bigint) drops leading zero nibbles, so pad(toHex(x), {size:32}) is unsafe for a
// 253-bit masked value: an odd hex-digit count (e.g. 63 digits for a 252-bit value) already
// looks "32 bytes" to pad()'s byte-rounding and gets left as-is -- 63 hex chars, not 64,
// silently misaligning every byte. Build the zero-padded 32-byte hex string directly instead.
function toHex32(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

// noir-jwt's ESM build has a broken extensionless import (./partial-sha) that Node's ESM
// resolver rejects; its CJS build resolves fine, so pull generateInputs in via require().
const require = createRequire(import.meta.url);
const { generateInputs } = require("noir-jwt");

const FIELD_MASK = (1n << 253n) - 1n;
function toField(hex) {
  return BigInt(hex) & FIELD_MASK;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- 1. RSA-2048 keypair + a real RS256-signed JWT -------------------------------------------
// generateKeyPairSync has no seed: every run mints a fresh RSA key, so pubkeyHash differs run to
// run even with identical wallet/promoteKey/nonce/chainId. Re-running this against the DEFAULT
// (local-fixture) params regenerates ../Prover.toml with a new pubkeyHash that will no longer
// match target/proof or RealVerifierIntegration.t.sol's hardcoded PUBKEY_HASH constant -- if you
// do, regenerate target/{proof,public_inputs} (nargo execute && bb prove && bb verify, see
// JwtRecoveryVerifier.sol's header) and update that constant together, in the same commit.
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 65537,
});
const jwk = publicKey.export({ format: "jwk" });

// Overridable via env so the same generator can produce both the fixed local test-vector (the
// defaults, matching RealVerifierIntegration.t.sol's hardcoded constants) and a live vector bound
// to a real deployed wallet address on a real chain (see live-run/generate.sh).
const wallet = process.env.WALLET ?? "0x1111111111111111111111111111111111111111";
const promoteKey = process.env.PROMOTE_KEY ?? "0x2222222222222222222222222222222222222222";
const nonce = BigInt(process.env.NONCE ?? "7");
const chainId = BigInt(process.env.CHAIN_ID ?? "84532"); // Base Sepolia
const outDir = process.env.OUT_DIR ?? "..";

// nonceBinding = toField(keccak256(abi.encode(wallet, promoteKey, nonce, chainid))) --
// contracts/src/OidcRecoveryGuardian.sol's expectedNonceBinding computation, reproduced here so
// the JWT's "nonce" claim can be set to its hex encoding before the JWT is signed.
const { encodeAbiParameters } = await import("viem");
const nonceBindingPreimage = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint256" }],
  [wallet, promoteKey, nonce, chainId],
);
const nonceBinding = toField(keccak256(nonceBindingPreimage));
const nonceBindingHex64 = nonceBinding.toString(16).padStart(64, "0");

const email = process.env.EMAIL ?? "alice@example.com";
const sub = process.env.SUB ?? "108734628375012345678";
// Deliberately NOT a real provider string by default -- this is a self-signed synthetic key, and
// attesting it into KeyRegistry under a real issuer name (e.g. "https://accounts.google.com")
// would misrepresent it as a Google-issued key to anything reading the registry. The keeper
// (script/keeper.mjs) is what attests REAL Google/Microsoft/Apple JWKS keys, live, from their
// real endpoints; this generator's output is only ever a synthetic key under an obviously-labeled
// synthetic issuer, kept separate on purpose.
const iss = process.env.ISS ?? "https://d7-demo.avok.internal/synthetic-issuer";
const kid = process.env.KID ?? "test-kid-1";

const header = { alg: "RS256", typ: "JWT", kid };
const payload = {
  iss,
  sub,
  email,
  email_verified: true,
  nonce: nonceBindingHex64,
  iat: 1755561600,
  exp: 1755565200,
};
const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
const signer = createSign("RSA-SHA256");
signer.update(signingInput);
signer.end();
const signature = signer.sign(privateKey);
const jwt = `${signingInput}.${base64url(signature)}`;

// --- 2. circuit inputs via noir-jwt's JS SDK --------------------------------------------------
const MAX_DATA_LENGTH = 1536;
const circuitInputs = await generateInputs({
  jwt,
  pubkey: jwk,
  maxSignedDataLength: MAX_DATA_LENGTH,
});

// --- 3. the two remaining public inputs, computed exactly as src/main.nr computes them --------
// pubkeyHash = toField(keccak256(rawModulusBytes)) -- same convention keeper.mjs uses off a JWKS
// "n" field; here reconstructed from the JWK directly rather than round-tripped through limbs.
const modulusBytes = Buffer.from(
  jwk.n.replace(/-/g, "+").replace(/_/g, "/").padEnd(jwk.n.length + ((4 - (jwk.n.length % 4)) % 4), "="),
  "base64",
);
const pubkeyHash = toField(keccak256(modulusBytes));

// identity = toField(keccak256(emailHash(32) || u16be(len(sub)) || sub padded to 64 ||
//   u16be(len(iss)) || iss padded to 64)) -- src/main.nr's exact fixed-length preimage layout.
const MAX_SUB_LENGTH = 64;
const MAX_ISS_LENGTH = 64;
const emailDigest = toBytes(keccak256(toBytes(email)));
const subBytes = toBytes(sub);
const issBytes = toBytes(iss);
if (subBytes.length > MAX_SUB_LENGTH) throw new Error("sub exceeds MAX_SUB_LENGTH");
if (issBytes.length > MAX_ISS_LENGTH) throw new Error("iss exceeds MAX_ISS_LENGTH");

const preimage = new Uint8Array(32 + 2 + MAX_SUB_LENGTH + 2 + MAX_ISS_LENGTH);
preimage.set(emailDigest, 0);
preimage[32] = (subBytes.length >> 8) & 0xff;
preimage[33] = subBytes.length & 0xff;
preimage.set(subBytes, 34);
const issLenOffset = 34 + MAX_SUB_LENGTH;
preimage[issLenOffset] = (issBytes.length >> 8) & 0xff;
preimage[issLenOffset + 1] = issBytes.length & 0xff;
preimage.set(issBytes, issLenOffset + 2);

const identity = toField(keccak256(preimage));

// --- 4. write Prover.toml -----------------------------------------------------------------------
function toDecArray(hexStrings) {
  return hexStrings.map((h) => BigInt(h).toString());
}

const dataStorage = circuitInputs.data.storage.slice(0, MAX_DATA_LENGTH);
while (dataStorage.length < MAX_DATA_LENGTH) dataStorage.push(0);

const lines = [];
lines.push(`base64_decode_offset = "${circuitInputs.base64_decode_offset}"`);
lines.push(`identity = "${toHex32(identity)}"`);
lines.push(`nonce_binding = "${toHex32(nonceBinding)}"`);
lines.push(`pubkey_hash = "${toHex32(pubkeyHash)}"`);
lines.push(`pubkey_modulus_limbs = [${toDecArray(circuitInputs.pubkey_modulus_limbs).map((v) => `"${v}"`).join(", ")}]`);
lines.push(`redc_params_limbs = [${toDecArray(circuitInputs.redc_params_limbs).map((v) => `"${v}"`).join(", ")}]`);
lines.push(`signature_limbs = [${toDecArray(circuitInputs.signature_limbs).map((v) => `"${v}"`).join(", ")}]`);
lines.push("");
lines.push("[data]");
lines.push(`storage = [${dataStorage.join(", ")}]`);
lines.push(`len = "${circuitInputs.data.len}"`);

const fs = await import("node:fs");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/Prover.toml`, lines.join("\n") + "\n");

fs.writeFileSync(
  `${outDir}/expected-public-inputs.json`,
  JSON.stringify(
    {
      pubkeyHash: toHex32(pubkeyHash),
      identity: toHex32(identity),
      nonceBinding: toHex32(nonceBinding),
      wallet,
      promoteKey,
      nonce: nonce.toString(),
      chainId: chainId.toString(),
      jwt,
    },
    null,
    2,
  ),
);

console.log("Wrote ../Prover.toml and expected-public-inputs.json");
console.log("pubkeyHash  ", toHex32(pubkeyHash));
console.log("identity    ", toHex32(identity));
console.log("nonceBinding", toHex32(nonceBinding));
