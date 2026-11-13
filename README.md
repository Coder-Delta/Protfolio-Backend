# Portfolio Backend

Node.js and Express API for the Vue portfolio, backed by MongoDB Atlas.

## Requirements

- Node.js 20+
- A MongoDB Atlas cluster

## Run locally

```bash
cd backend
npm install
cp .env.example .env
```

Set `MONGODB_URI` to the connection string from Atlas and `MONGODB_DB_NAME` to
the database name to use. In Atlas, create a database user and allow the
backend host in Network Access. Keep the URI and analytics credentials private.
Configure the SMTP and `CONTACT_EMAIL_*` variables in `.env` to receive email
alerts for contact-form submissions. For Gmail, use an App Password rather than
your account password. Contact messages stay in MongoDB; if SMTP delivery fails,
the request reports the failure and the stored message is marked
`notification_status: "failed"`.
Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` for administrator-uploaded project banners. Images are
uploaded by the backend and their Cloudinary URL is stored with the project in
MongoDB; the projects GET endpoints return that URL for the frontend to display.
Cloudinary credentials stay on the backend.

```bash
npm run migrate
npm run dev
```

The API listens on `http://localhost:5000`. The Vue app already defaults to
`http://localhost:5000/api`; set `VITE_API_BASE_URL` in the frontend environment
to the deployed API URL when publishing the frontend.

`npm run migrate` creates indexes and aligns the project ID counter.
Projects are added manually from the Projects page after signing in to the
Analytics dashboard. The Projects API reads only manually created MongoDB
records; it does not synchronize or derive project details or images from
GitHub. Older repository records are retained in MongoDB but hidden from the
public Projects API.

This MongoDB setup does not automatically import records from the previous
PostgreSQL database. Export and import existing contact messages or analytics
separately if those records need to be retained.

## Frontend API

All responses use `{ "success": true, "data": ... }` on success and a JSON
`message` on errors.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Confirms the API and MongoDB are available |
| GET | `/api/projects` | Lists manually added projects, featured first and then by display order |
| GET | `/api/projects/:id` | Reads a manually added project by its numeric ID |
| POST | `/api/projects` | Creates a project (admin bearer token required); multipart fields: `title`, `description`, `liveLink`, and image file `banner` |
| POST | `/api/contact` | Validates and stores a contact form submission, then emails the configured recipient |

## Analytics

Analytics events are accepted only after consent. Public, rate-limited routes
are `POST /api/analytics/consent`, `/consent/withdraw`, `/session`, `/page-view`,
`/project-view`, `/event`, and `/session-end`. The private dashboard uses
`POST /api/analytics/admin/login` and
`GET /api/analytics/admin/summary?days=30` (also 1, 7, or 90 days; custom
`start=YYYY-MM-DD&end=YYYY-MM-DD` ranges are supported).

Set `ANALYTICS_ADMIN_PASSWORD` and a separate random
`ANALYTICS_ADMIN_TOKEN_SECRET` in deployment settings. Analytics stores
anonymous IDs and coarse device/location data, never names, email addresses,
raw user-agent strings, or browser fingerprints. Request IPs are stored only
with consent and cleared after `ANALYTICS_IP_RETENTION_DAYS` (30 by default).
Analytics records are removed after `ANALYTICS_RETENTION_DAYS` (365 by default).
Sign in to the analytics dashboard to create the eight-hour admin session; the
Projects page shows the project creation form while that session is present.
The backend independently verifies the token before accepting project writes.

## Deployment

Configure these backend environment variables in the hosting provider:

- `MONGODB_URI`, `MONGODB_DB_NAME`
- `FRONTEND_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- `CONTACT_EMAIL_FROM`, `CONTACT_EMAIL_TO`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `ANALYTICS_ADMIN_PASSWORD`, `ANALYTICS_ADMIN_TOKEN_SECRET`

For Vercel, the repository's root `vercel.json` directs requests to
`backend/server.js`. MongoDB connections are reused within a warm function
instance; use an Atlas connection string and allow the function's outbound
network access in Atlas.
# Protfolio-Backend
