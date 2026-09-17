# ClientOS production deployment

Production URL: **https://os.rohitkumarseo.com**
Infrastructure: existing Hostinger VPS `srv1904708.hstgr.cloud` (id `1904708`),
Docker Compose project name `clientos`, routed through the VPS's existing
Traefik instance (automatic Let's Encrypt TLS).

## One-time setup

1. **GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `HOSTINGER_API_TOKEN` — generate at hPanel → API
     (https://hpanel.hostinger.com/profile/api).
   - `HOSTINGER_VPS_ID` — `1904708`.
   - `GITHUB_TOKEN` is automatic; no action needed.

2. **Hostinger VPS project environment** (set once via `VPS_createNewProjectV1`'s
   `environment` field, or the hPanel Docker Manager UI — never in git):
   ```
   GHCR_OWNER=<github org/user that owns this repo>
   DB_PASSWORD=<generate a strong random password>
   DB_ROOT_PASSWORD=<generate a different strong random password>
   ADMIN_SESSION_SECRET=<openssl rand -base64 48>
   SMTP_HOST=
   SMTP_PORT=587
   SMTP_USER=
   SMTP_PASSWORD=
   SMTP_FROM=ClientOS <notifications@rohitkumarseo.com>
   ```
   Razorpay variables are intentionally omitted — Razorpay is not being
   integrated in this deployment. WhatsApp variables are likewise omitted;
   the reminder engine's WhatsApp channel already fails closed when unset.

3. **First deploy only**: create the Compose project once, pointing at this
   repo (subsequent deploys go through `.github/workflows/deploy.yml`, which
   calls the `update` endpoint instead of `create`):
   ```
   POST https://developers.hostinger.com/api/vps/v1/virtual-machines/1904708/docker
   { "project_name": "clientos", "content": "https://github.com/<owner>/<repo>" }
   ```

## Normal deploy flow

```
local change → npm test / tsc / eslint / npm run build (all pass)
  → git commit → git push origin production
  → GitHub Actions: test job (repeats the same checks) → deploy job
  → image built + pushed to ghcr.io/<owner>/clientos
  → Hostinger API pulls the new image and recreates the container
  → os.rohitkumarseo.com serves the new version
```

A failing test/lint/build/typecheck stops the workflow before the deploy job
ever runs — nothing broken reaches production.

## Database safety

- `clientos_prod` (this deployment) and `clientos_dev` (local development)
  are separate MySQL/MariaDB instances entirely — different containers,
  different hosts, different credentials. Nothing here ever points at the
  dev database, and nothing in dev points at prod.
- The container entrypoint runs `prisma migrate deploy` on every start —
  this only applies migrations already committed to `prisma/migrations/`.
  It never generates a migration, never drops a table, and is a no-op when
  the schema is already current. `prisma migrate reset` and `prisma db push`
  are never used against this database.
