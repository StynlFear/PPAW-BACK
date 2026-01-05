# PPAW Backend

TypeScript/Express API backed by Postgres (via Prisma) with image uploads stored in Supabase Storage.

- OpenAPI spec: `openapi.yaml`
- Swagger UI (when running): `http://localhost:3000/docs`
- Raw spec (when running): `http://localhost:3000/openapi.yaml`

## Prerequisites

- Node.js (recommended: 20+)
- A Postgres database (Supabase Postgres works)
- Supabase Storage bucket named `ppaw` (used for image uploads)

## Quickstart

```bash
npm install

# create your local env file
copy .env.example .env

# generate Prisma client
npm run prisma:generate

# optional: validate DB connectivity
npm run db:test

# start the dev server (ts-node)
npm run dev
```

Then open `http://localhost:3000/docs`.

## Environment variables

Create a `.env` file (start from `.env.example`).

| Variable | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | Yes | Prisma connection string. For Supabase, this can be the pooled (PgBouncer) URL for runtime queries. |
| `DIRECT_URL` | Recommended | Direct Postgres URL (non-pooler). Useful for Prisma operations that require a direct connection. |
| `JWT_SECRET` | Yes | Secret for signing/verifying JWTs. |
| `JWT_EXPIRES_IN` | No | Defaults to `7d` if unset. |
| `SUPABASE_URL` | Yes (for uploads) | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended (for uploads) | Preferred storage key (server-side). The code will also accept `SUPABASE_SERVICE_KEY` or `SUPABASE_ANON_KEY`. |
| `SUPABASE_ANON_KEY` | Fallback | Works if your Storage rules allow it; service role is recommended for server-side uploads. |
| `PORT` | No | Defaults to `3000`. |

## Database setup

This repo does **not** contain Prisma migrations. Schema changes are tracked as SQL scripts in `prisma/sql/`.

- Apply the SQL files in `prisma/sql/` to your Postgres database in timestamp order.
- Ensure your database has the tables referenced by `prisma/schema.prisma`.
- After updating the DB schema, regenerate Prisma client:

```bash
npm run prisma:generate
```

## Running

### Development

Runs directly from TypeScript:

```bash
npm run dev
```

### Production

Builds into `dist/` then runs Node:

```bash
npm run build
npm start
```

## API notes

- Base URL (local): `http://localhost:3000`
- Authentication: endpoints that require auth expect `Authorization: Bearer <jwt>`.
- The `/auth/register` and `/auth/login` endpoints return a JWT.

### Uploads

`POST /images/upload` expects `multipart/form-data`:

- `file`: the image file (max 25 MB)
- `userId`: UUID of the user

Images are uploaded to Supabase Storage bucket `ppaw` under `images/<userId>/...`.

## Scripts

- `npm run dev` — start API via `ts-node`
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled server (`dist/app.js`)
- `npm run prisma:generate` — generate Prisma client
- `npm run db:test` — basic DB connectivity check
