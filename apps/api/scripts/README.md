# API scripts

## `apply-r2-cors.ts` — apply Cloudflare R2 bucket CORS

The Documents tab and other direct-to-R2 upload surfaces (insurance certificates,
branding logo, disputes evidence, boat photos) PUT files straight from the
browser to a presigned URL on the bucket. R2 will reject those requests at the
network layer if the bucket's CORS policy doesn't allow `PUT` from the calling
origin and the `Content-Type` request header — the browser surfaces this as
`TypeError: Failed to fetch`.

The canonical CORS policy is checked into the repo at `apps/api/r2-cors.json`.
Re-apply it whenever:

- the production web origin changes,
- a new dev preview origin needs to upload, or
- the R2 bucket is recreated and forgets its previous policy.

### Run it

```bash
# Required env
#   R2_ENDPOINT              https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET                helmv2 (default `helm-files` if unset)
#   R2_ACCESS_KEY_ID         token with bucket-admin scope (NOT the runtime
#   R2_SECRET_ACCESS_KEY     object-only token used by the API server)
# Optional, automatically appended to AllowedOrigins if set:
#   APP_URL, APP_PORTAL_URL, APP_ADMIN_URL, REPLIT_DEV_DOMAIN

pnpm --filter @helm/api apply:r2-cors
```

> **Heads up:** the R2 token the API uses at runtime (`R2_ACCESS_KEY_ID` in
> normal Replit secrets) is scoped to *object* operations (Get/Put/Delete on
> objects under `helmv2/`). `PutBucketCors` is a *bucket admin* call and will
> return `AccessDenied` with that token. Issue a short-lived
> Account-level R2 API token (Cloudflare dashboard → R2 → Manage API
> Tokens → Create → Admin Read & Write) and export it into the shell before
> running this script. The script prints the exact remediation steps if it
> hits `AccessDenied`.

The script:

1. Reads `apps/api/r2-cors.json` (stripping `_comment` keys).
2. Appends `APP_URL`, `APP_PORTAL_URL`, `APP_ADMIN_URL`, and the active
   Replit dev preview (`https://$REPLIT_DEV_DOMAIN`) to the AllowedOrigins
   list, deduped.
3. Calls `PutBucketCors` against the R2 S3-compatible endpoint.
4. Reads the policy back via `GetBucketCors` and prints it for verification.

### Wrangler / dashboard alternatives

If `wrangler` is preferred:

```bash
wrangler r2 bucket cors put helm-files --rules apps/api/r2-cors.json
```

Or apply manually in the Cloudflare dashboard:
**R2 → helm-files → Settings → CORS Policy → Edit** and paste the
`CORSRules` array.

### Verifying from a browser

After applying, hard-refresh the web app and upload a small PDF on a customer's
Documents tab. The Network tab should show:

- `OPTIONS` preflight to the presigned URL host → `204` with
  `Access-Control-Allow-Origin: <your origin>` and
  `Access-Control-Allow-Methods: PUT`.
- `PUT` to the presigned URL → `200` or `204` with an `ETag` header.
- `POST /api/storage/verify-upload` → `200`.
- `POST /api/customers/:id/documents` → `201`.
