# Signed Skill Bundles

Open42 exports each `SKILL.md` bundle with a detached Ed25519 signature.

## Bundle Contents

Each exported zip contains:

- `<skill-name>/SKILL.md`
- `<skill-name>/SKILL.md.sig`
- `<skill-name>/frontmatter.yaml`
- `<skill-name>/manifest.json`

`SKILL.md.sig` is base64-encoded Ed25519 over the SHA-256 digest of canonical
`SKILL.md`. Canonical markdown uses LF line endings, trims trailing whitespace
on each line, and has exactly one trailing newline.

`manifest.json` includes:

- `signature_algorithm`: `Ed25519`
- `signed_payload`: `SHA-256(canonical SKILL.md)`
- `signed_payload_sha256`: lowercase hex SHA-256 digest
- `public_key_url`: workspace public key endpoint

## Ephemeral Share URLs

Share URLs use the form `/shared/{opaque-signed-token}.zip`. Tokens are
URL-safe bearer values containing a random nonce and an HMAC-SHA256 signature
keyed by the server secret. Open42 stores only `SHA-256(token)`, not plaintext
tokens. Links expire after 24 hours.

## Public Key

The workspace public key is available from the API at:

```text
/workspaces/{workspace-id}/signing-key.pub
```

The web app also proxies the same key at `/api/workspaces/{workspace-id}/signing-key.pub`.

The endpoint returns PEM text for workspaces that have exported at least one
signed skill bundle. Key rotation is not implemented in P1.

## Verify

This Node snippet verifies a downloaded bundle:

```js
import AdmZip from 'adm-zip';
import { createHash, createPublicKey, verify } from 'node:crypto';

const zip = new AdmZip('refund-policy-skill.zip');
const skillMd = zip.readAsText('refund-policy/SKILL.md');
const signature = Buffer.from(zip.readAsText('refund-policy/SKILL.md.sig').trim(), 'base64');
const publicKeyPem = await fetch(
  'https://api.open42.ai/workspaces/{workspace-id}/signing-key.pub',
).then((res) => res.text());

const canonical = skillMd
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n*$/, '\n');
const digest = createHash('sha256').update(canonical, 'utf8').digest();
const ok = verify(null, digest, createPublicKey(publicKeyPem), signature);

console.log(ok ? 'valid' : 'invalid');
```
