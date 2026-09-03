# ClientOS

Internal SaaS for managing Rohit's marketing/SEO agency clients — recurring
billing, payments, monthly work, reminders, and renewals. Not a generic CRM;
scoped only to this agency business (hard-separate from digital-products-bundle,
a different business on a different domain).

Full founding brief and phased plan: see `docs/superpowers/specs/`.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **MySQL** + **Prisma 7** (driver-adapter architecture, same pattern as
  digital-products-bundle — Hostinger shared hosting only offers MySQL)
- **Razorpay** for payments (own keys, own webhook — never shared with any
  other project)
- **Nodemailer** direct SMTP for reminder email
- Target host: Hostinger shared hosting, own subdomain, own database —
  fully separate from every other project on this account

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, etc.
npm run db:migrate     # applies Prisma migrations, generates the client
npm run dev            # http://localhost:3000
```

## Security notes

- No secrets in this repo. `.env` is gitignored; `.env.example` holds only
  placeholder keys/comments.
- The global "Automatic Client Communication" switch defaults OFF
  (`OrganizationSettings.automaticClientCommunicationEnabled`) and is
  enforced server-side, not just in the UI.
- Historical billing periods, payments, and task instances are never
  overwritten — a fee/plan change creates new rows going forward.
