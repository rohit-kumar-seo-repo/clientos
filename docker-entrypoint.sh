#!/bin/sh
# Runs on every container start, before the server begins serving traffic.
#
# `prisma migrate deploy` ONLY applies migrations already committed to
# prisma/migrations/ — it never generates new ones, never drops data, and
# never resets the schema. It is a no-op (exits 0 immediately) when the
# database is already up to date, so this is safe to run on every restart.
# NEVER replace this with `prisma db push` or `prisma migrate reset`.
set -e

echo "Applying pending Prisma migrations (safe, additive-only)..."
npx prisma migrate deploy

# Only ever creates an admin account if literally none exist yet — a no-op
# on every later restart once one does. See prisma/bootstrap-admin.ts.
echo "Checking for an admin account..."
npx tsx prisma/bootstrap-admin.ts

echo "Checking Razorpay connectivity..."
npx tsx prisma/check-razorpay.ts

echo "Starting ClientOS..."
exec "$@"
