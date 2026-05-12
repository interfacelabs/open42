# Troubleshooting

## API Refuses To Start

Check that required secrets are not blank or placeholder values:

- `OPEN42_KEK`
- `SESSION_SECRET`
- Supabase values
- `DATABASE_URL`

The API rejects placeholder secrets at boot.

## Cannot Sign In

Check:

- Supabase URL and keys are correct.
- The magic link redirect URL points back to the Open42 web app.
- Browser cookies are enabled.
- API and web public URL variables match how you access the app.

## Chat Says Provider Key Is Missing

Community mode does not use shared provider keys by default. Sign in as the
workspace owner and add provider keys in Settings.

## gbrain Is Not Ready

Check the gbrain container:

```bash
docker compose -f docker-compose.community.yml logs gbrain
```

Then check the API:

```bash
docker compose -f docker-compose.community.yml logs api
```

The API verifies the gbrain version during provisioning. The version should
match `GBRAIN_VERSION`.

## Notion Zip Import Fails

The zip connector enforces entry count, entry size, total size, and compression
ratio limits. Re-export a smaller Notion workspace or split the export.

## Composio Connection Fails

Confirm:

- `COMPOSIO_API_KEY` is set.
- `COMPOSIO_NOTION_AUTH_CONFIG_ID` is set.
- `OPEN42_INGEST_HMAC_SECRET` is set.
- `COMPOSIO_WEBHOOK_SECRET` is set when receiving webhooks.

If you want zip-only import, leave Composio unset.
