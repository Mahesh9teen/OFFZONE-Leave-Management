# OFFZONE - Leave Management

OFFZONE is a full-stack leave-management application built with **Angular, NestJS, TypeScript, and PostgreSQL**. Employees request time off, managers review their own reports, and admins configure the rules. Balances, overlapping dates, and daily team coverage are enforced by the API, not just the interface.

## What is included

- Employee, manager, and admin workspaces with server-side authorization.
- Annual, sick, and unpaid leave; admins can add types and edit yearly allowances.
- Date validation, inclusive working-day calculation, weekends, and editable public holidays.
- Pending reservations, approval/rejection, and cancellation that restores the balance.
- Full-day and single-date morning/afternoon leave, charged in 0.5-day units.
- Versioned editing of future pending requests, with manager notification and stale-decision protection.
- Per-employee overlap protection and transaction-safe per-team AM/PM capacity limits.
- A monthly team calendar, employee balance summaries, and stacked balance charts.
- Employee calendar booking: select one day or a range, see advisory availability, and open a prefilled leave form.
- Configurable notice periods, allowances, and maximum people off.
- Employee profile editing and password changes that invalidate older sessions.
- Admin people/team management, account deactivation safeguards, and preserved leave history.
- In-app leave notifications and private supporting documents.
- CSV exports, upcoming leave summaries, and team availability insights.
- Role-scoped monthly leave analytics and Outlook/Google-compatible calendar exports.
- Capped carry-over from 2027, with March 31 expiry and preserved historical funding.
- Automatic in-app approval reminders and optional, queued SMTP email notifications.
- **1 admin, 2 managers, 8 employees, 3 leave types, 12 demo holidays, and exactly 40 seeded requests** in mixed states.
- Automated unit and PostgreSQL/API tests, coverage gates, strict type checking, and CI.
- Responsive layouts, accessible native dialogs, error states, and a server-validated availability preview.

No paid services, external AI API, or internet connection are needed for the default local application. Optional email delivery requires a configured SMTP service.

## Quick start: Docker

Install **Node.js 24.15+ within the 24.x line** and **Docker Desktop** with Linux containers. Node 22.22.3+ within 22.x is also supported. Start Docker Desktop.

From the repository root:

```shell
npm run setup
docker compose up --build -d --wait
docker compose exec api node apps/api/dist/db/cli.js seed
```

Open **http://localhost:8085**.

After source changes, run `docker compose up --build -d --wait api web` again to refresh both application services. Restarting an old image alone will not update the application name or features. The existing database volume is preserved, and the API applies only migrations that have not already run.

`npm run setup` uses only Node built-ins; a host `npm install` is not needed for this Docker path. It creates an ignored `.env` with unique local database credentials, a signing secret, and a demo password. It will **not overwrite** an existing `.env`.

### Demo accounts

Password-based account sign-in uses the **`SEED_PASSWORD` value in your local `.env`** for all seeded users. There is deliberately no universal password in source control.

### Open demo sign-in (optional)

For a demo-only installation, set `DEMO_LOGIN_ENABLED=true` in `.env`, then rebuild/recreate the app with `docker compose up --build -d --wait` (or restart the development API). The Welcome back page will show:

- An **Employee portal / Manager portal / Admin portal** selector.
- Demo email and password examples directly below their inputs, updated for the selected portal. These public examples work only in demo mode; they are not the real account passwords.
- An **Important note** immediately below the sign-in button explaining that any dummy email address and password can be used.
- A link to **Use account credentials instead** for normal password-verified access.

Select a portal, enter any syntactically valid demo email and any non-empty password, and sign in. The dummy values are not transmitted or stored. The server signs in only the fixed seeded account for that portal: `employee1`, `manager1`, or `admin`. It never creates a user or assigns privileges from an entered email. Normal account login continues to verify passwords.

**Open demo access is disabled by default.** Enable it only with fictional/demo data: visitors share the same accounts, and the Admin portal can change configuration. Server-side employee/report/admin restrictions still apply. Set `DEMO_LOGIN_ENABLED=false` and recreate/restart the API to hide the demo selector, block demo sign-in, and invalidate existing demo sessions. Password-authenticated sessions remain valid.

### Seeded accounts

| Role | Email | Team / visibility |
| --- | --- | --- |
| Employee | `employee1@example.test` through `employee4@example.test` | Product & Design |
| Employee | `employee5@example.test` through `employee8@example.test` | Engineering |
| Manager | `manager1@example.test` | Product & Design, four reports |
| Manager | `manager2@example.test` | Engineering, four reports |
| Admin | `admin@example.test` | All teams; configuration access |

Seed names and holidays are fictional/demo data, not a jurisdiction-specific holiday calendar. Seeding is non-destructive: if users already exist, it leaves their data and configuration untouched. Changing `SEED_PASSWORD` later does **not** reset existing account passwords.

Useful commands:

```shell
docker compose ps
docker compose logs api
docker compose stop
docker compose start
```

The database persists in the project's Docker volume. `docker compose down` removes the containers but preserves that volume. Do not remove the volume unless you intentionally want to erase the data.

### Local development

```shell
npm ci
npm run setup
docker compose up -d --wait db
npm run build
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:4200**. Angular proxies `/api` to the API on `127.0.0.1:3001`; PostgreSQL is exposed only on `127.0.0.1:55432`. Ports 8085 and 3001 avoid commonly occupied 8080/3000 services.

The default `.env` supports the development origin. Docker overrides it with `DOCKER_APP_ORIGIN`. Choose the URL appropriate to the process you start; cookies and origin validation intentionally reject cross-origin mutations.

### Environment variables

Use [.env.example](.env.example) as the reference. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for host-side development, migrations, and tests. |
| `AUTH_SECRET` | At least 32 characters; setup generates a unique signing secret. |
| `APP_ORIGIN` | Exact browser origin, without a trailing slash. Development default: `http://localhost:4200`. |
| `COOKIE_SECURE` | `false` only for local HTTP; set `true` behind HTTPS in production. |
| `PORT` | Development API port, default `3001`. If changed, update the Angular proxy target. Docker uses internal port 3000. |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Docker database initialization. |
| `DB_PORT` | Local database port, default `55432`. Update `DATABASE_URL` too if changed. |
| `WEB_PORT` | Docker web port, default `8085`. |
| `DOCKER_APP_ORIGIN` | Exact Docker browser origin; update along with `WEB_PORT`. |
| `SEED_PASSWORD` | 12-256 characters; required only when creating demo accounts. |
| `DEMO_LOGIN_ENABLED` | `false` by default. Explicitly set `true` only for shared demo-account access without password verification. Never enable it against real employee data. |
| `TEST_DATABASE_URL` | Optional integration-test connection, otherwise `DATABASE_URL` is used. |
| `NODE_ENV` | `development`, `test`, or `production`. Docker supplies `production`. |
| `JOBS_ENABLED` | Defaults to `true` outside tests. Enables periodic carry-over finalization, reminders and email processing. |
| `JOBS_POLL_MS` | Poll interval, default `60000`; accepted range 1000-3600000 milliseconds. |
| `EMAIL_ENABLED` | Defaults to `false`. When disabled, no email jobs are created or sent; in-app notifications still work. |
| `SMTP_URL` | Required when email is enabled: `smtp://...` or `smtps://...`. Percent-encode credentials in the URL and keep it only in environment configuration. |
| `SMTP_FROM` | Required sender email address when email is enabled. |
| `SMTP_REQUIRE_TLS` | Defaults to `true`. Keep enabled for real SMTP servers. Plaintext is allowed only for explicit local/test SMTP doubles, not remote production servers. |

`npm run setup` generates URL-safe database credentials. If configuring the connection manually, URL-encode special characters in `DATABASE_URL`. Changing PostgreSQL initialization variables does not change credentials in an already initialized volume.

## Business rules

1. **Roles:** only employees submit leave. Only the manager of the employee's team can approve or reject. Admins configure policies but cannot bypass manager approval. Employees can cancel their own pending or approved requests.
2. **Dates and half-days:** dates are calendar dates in UTC, inclusive at both ends. Saturday, Sunday, and configured public holidays are excluded. Full-day ranges must contain at least one working day and span at most 366 calendar days. Morning (`am`) and afternoon (`pm`) requests must use one working date and charge 0.5 day. API dates are bounded to 2000-2100.
3. **Notice:** a request's start date must be at least `minNoticeDays` calendar days after the server's UTC date. Zero permits today, never a past start. The rule applies to all leave types.
4. **Balance:** base allowance and carry-over funding are tracked separately. Remaining days are unused base allowance plus currently valid, unused carry-over. Rejected/cancelled requests release only their original funding; expired carry-over refunds do not become base allowance. Unpaid leave has its own allowance.
5. **Calendar years:** base allowances reset each January without prorating. From 2027, eligible types carry at most 5 unused prior-year **base** days, expiring March 31. Annual is eligible by default; admins can change eligibility for future grants. Carry-over does not roll again. Cross-year requests are split by charged dates; grants cannot be spent before January.
6. **Overlap:** pending/approved requests cannot intersect on the same AM/PM period, even across different leave types. Opposite half-days on the same date are allowed. Full-day requests occupy both periods.
7. **Coverage:** distinct employees with pending/approved working dates count independently in AM and PM **within their team**. The configured maximum applies to each period; other teams do not consume capacity.
8. **Decisions and edits:** only `pending -> approved/rejected` and `pending/approved -> cancelled` are allowed. Employees can edit their own pending requests only while the original start date is in the future. Updates recheck overlap, balance and coverage; changes to dates/type/period also reapply notice. Unchanged dates retain their snapshotted holiday charges. Edits increment a version; managers must review that version before deciding. No new cancellation cutoff is imposed.
9. **Policy changes:** new requests use the latest settings. Approval rechecks allowance and coverage, but does not reapply submission notice. Lowered limits may make a balance negative or prevent approval; existing reservations are never silently removed, and rejection/cancellation can still release them.
10. **Holiday changes:** charged working dates are snapshotted at submission. Later holiday edits affect new submissions, not historical charges. Allowance changes apply to the displayed calendar-year balances.
11. **Privacy:** employees see only their own balances and request reasons. The shared team calendar contains names, leave type, dates, and status, but no reasons. Managers see their own reports; admins can inspect all teams.

The availability preview runs the same server rules as submission. It is advisory, not a reservation: submission always checks again.

### Carry-over and reminders

Carry-over grants are issued once per employee/type/year and stored in half-day units. The scheduler, first workspace read, and reservation/configuration changes finalize due grants before earlier-year changes can inflate them. Grants are based on the prior-year base balance using the allowance in force when the grant is issued, subtracting pending and approved base-funded days. Existing grants never change after cancellation or policy edits. Accounts/types created during the grant year receive no prior-year grant. Existing balances before 2027 are unchanged.

Eligible January-March dates use available carry-over first; dates after March 31 always use base allowance. A request approved after expiry retains carry-over legitimately reserved before expiry. Future-year bookings made before January use base allowance and are not retroactively refunded when a grant appears.

Upcoming pending requests receive an in-app reminder after 48 hours since submission or their last edit, then at most once every 24 hours until decided. Workers claim rows transactionally, avoiding duplicate reminders across API instances. Editing restarts the reminder age; decided requests are excluded.

### Optional email delivery

Configure `SMTP_URL` and `SMTP_FROM`, then explicitly set `EMAIL_ENABLED=true` and recreate the API. Keep real credentials out of source control and never enable real delivery for publicly shared fictional accounts.

Notifications and email jobs commit in the same database transaction. Email is sent afterwards; a mail outage does not undo a leave request. Delivery retries with backoff up to five attempts; permanent failures remain visible in admin settings and server logs. Inactive recipients are skipped. Jobs resume after restart; SMTP uses a stable Message-ID on retries, but a crash after server acceptance can still cause a duplicate because SMTP cannot guarantee exactly-once delivery.

Messages contain a short update title and the workspace URL, not employee leave reasons or attachments. Queued and failed counts appear under **Settings > Reminders and email notifications**. Disabling email pauses queued delivery without deleting in-app notifications. Failed messages are retained for operator investigation rather than silently discarded.

### Accounts, notifications, and documents

- Employees can edit their own name, phone, and job title. The account page does not offer profile-photo upload or removal controls. Existing avatars and the authenticated photo APIs remain unchanged.
- Password changes require the current password and invalidate earlier sessions. They are unavailable in open demo sessions; use account credentials instead. Other demo edits, including profile and admin changes, affect shared demo data.
- Admins manage employees, managers, and teams. Team assignment is locked after leave history exists, and deactivation cannot bypass pending/upcoming leave or team-manager safeguards.
- In-app notifications link to the relevant request and support individual or bulk read state.
- A request owner can add or remove up to three supporting documents while the request is pending. PDF, JPEG, and PNG content is accepted up to 5 MiB per file. The owner, the reporting manager, and admins can read the documents; they are not public links.
- Request and balance screens offer CSV downloads. Team insights show upcoming leave and coverage without changing reservations.

### Request leave from the employee calendar

1. Open **Team calendar** in the Employee portal.
2. Choose **Full day / date range**, **Morning (AM)**, or **Afternoon (PM)**. Half-day selection uses exactly one available date. In full-day mode, tap a second date to select a range; endpoints are ordered automatically.
3. Review the highlighted range and working-day count. Weekends and holidays inside a range are excluded. Past dates, insufficient notice, existing leave, and full team capacity are explained on the calendar; a blocked working day anywhere inside the range prevents continuing.
4. Select **Request selected dates**. The existing leave form opens with the start/end dates filled in. Choose the leave type, enter a reason, check availability, and submit normally.

A third date tap starts a new selection; **Clear selection** removes it. Unavailable dates remain clickable to inspect team coverage, but cannot be chosen as endpoints. The normal **Request leave** button still opens a blank form, including for cross-year requests. Managers and admins keep their read-only calendar booking view.

Calendar labels use the current dashboard snapshot and do not guarantee sufficient balance. The form's server preview and submission still enforce the complete, current rules. Refresh the workspace if another person has changed requests or policy.

### Calendar export and analytics

**Export calendar (.ics)** downloads the selected team/month's approved and tentative pending working dates. Full days are all-day events with exclusive end dates; AM uses 09:00-13:00 UTC and PM uses 13:00-17:00 UTC. Weekends/holidays not charged by the request are not exported. Import the file through Outlook or Google Calendar's import tools. This is a snapshot, not a subscription: later edits/cancellations do not automatically update a previously imported calendar. Leave reasons and supporting documents are excluded.

**Monthly analytics** summarizes approved, pending, rejected and cancelled days, plus request counts, for the selected year and leave type. Half-days contribute 0.5. Employees see only their own requests, managers their reports, and admins all teams. A cross-month request counts in each affected month, but charged days are never double-counted. CSV export uses the same filtered data.

## Architecture

```text
Angular standalone components + shared TypeScript contracts
                        |
             same-origin HTTP /api
                        |
        Nginx (Docker) / Angular proxy (dev)
                        |
    NestJS origin, session, and role guards
              + Zod boundary validation
                        |
            LeaveService + pure rules
                        |
      PostgreSQL repository / transactions
                        |
                   PostgreSQL
```

| Location | Responsibility |
| --- | --- |
| [apps/web/src/app](apps/web/src/app) | Role-aware shell, requests, calendar, charts, settings, and API client. |
| [apps/api/src/domain/rules.ts](apps/api/src/domain/rules.ts) | Pure working-day, balance, overlap, coverage, and transition rules. |
| [apps/api/src/leave.service.ts](apps/api/src/leave.service.ts) | Workflow orchestration and defense-in-depth authorization. |
| [apps/api/src/accounts.service.ts](apps/api/src/accounts.service.ts) | Profiles, photos, and admin people/team management. |
| [apps/api/src/notifications.service.ts](apps/api/src/notifications.service.ts), [documents.service.ts](apps/api/src/documents.service.ts) | Recipient-scoped notifications and authenticated request documents. |
| [apps/api/src/db](apps/api/src/db) | SQL repository, versioned schema migration, and reproducible demo data. |
| [apps/api/src/auth](apps/api/src/auth) | Salted scrypt password hashes, signed sessions, and access guards. |
| [apps/api/src/http](apps/api/src/http) | Validated API endpoints and explicit error responses. |
| [packages/contracts](packages/contracts) | Shared, strictly typed request/response models. |
| [infra/nginx.conf](infra/nginx.conf) | Same-origin production reverse proxy and SPA serving. |

The application uses `pg` directly instead of an ORM so the small schema, lock ordering, and reservation queries are explicit. Nest's dependency injection keeps the domain and workflows independently testable.

### Why concurrent requests cannot overspend

Every creation, preview, approval, rejection, and cancellation runs in a database transaction:

1. Acquire a shared lock on the singleton settings row.
2. Lock the relevant team row with `FOR UPDATE`.
3. Read the team's latest requests and evaluate the rules.
4. Write the new request/state, then commit.

Competing mutations for the same team serialize, including requests from the same employee. Separate teams can proceed independently. Admin writes take an exclusive settings lock, so policies cannot change midway through a reservation. Every writer follows the same lock order. Integration tests race two real HTTP submissions for the final balance and coverage slot.

Dashboard reads use repeatable-read snapshots after any due carry-over grants are finalized. Configuration and request edits carry version numbers and reject stale edits instead of overwriting another person's work.

### Data model

| Table | Important fields and relationships |
| --- | --- |
| `teams` | UUID, unique name. |
| `users` | UUID, unique normalized email, password hash, role, team FK, profile/photo fields, active state, and session version. A partial unique index allows one manager per team. Admins have no team. |
| `leave_types` | UUID, unique case-insensitive name, yearly allowance, carry-over eligibility and creation timestamp. |
| `settings` | One row: minimum notice, maximum members off, configuration version. |
| `holidays` | Unique calendar date and label. |
| `leave_requests` | Employee/type FKs, dates, snapshotted charged-date array, AM/PM/full period, reason, status, version, original carry-over allocations, timestamps, reminder time, and decision actor/note. |
| `carryover_grants` | Unique employee/type/year grants, half-day units and fixed expiry date. |
| `notifications` | Recipient/request FKs, title, message, creation time, read state, deterministic event key and ordered event sequence. |
| `email_outbox` | One job per notification, delivery status, attempt count, retry time, lease and safe error code. |
| `request_documents` | Request/uploader FKs, validated filename/type, bounded binary content, and creation time. |
| `schema_migrations` | Applied migration versions and timestamps. |

Balances are derived from requests, not a mutable counter. Cancelling changes the status atomically; the released days appear in the next balance calculation, so there is no separate increment to miss or double-apply.

### API overview

All paths start with `/api`. Mutation requests require an `Origin` matching `APP_ORIGIN` and, except login/logout, an authenticated cookie.

| Method / path | Access |
| --- | --- |
| `GET /health` | Public readiness check, including the database. |
| `POST /auth/login` | Public, rate-limited; sets an HttpOnly, SameSite=Strict cookie. |
| `GET /auth/options` | Public; exposes only whether open demo sign-in is enabled. |
| `POST /auth/demo-login` | Public, rate-limited, and gated by `DEMO_LOGIN_ENABLED`; accepts only `{ "role": "employee" }`, `"manager"`, or `"admin"` and signs into that fixed seeded account. |
| `POST /auth/logout` | Clears the cookie, even for an expired session. |
| `GET /auth/me` | Authenticated user from the database, never a client-supplied role. |
| `GET /workspace?year=2026` | Role-scoped requests, calendar, balances, and policy. |
| `POST /requests/preview` | Employee; same input and validation as creation. |
| `POST /requests` | Employee; creates a pending reservation. |
| `PATCH /requests/:id` | Owner edits a future pending request; requires the latest `version`. |
| `POST /requests/:id/preview` | Owner previews a pending edit with its `version`; does not save it. |
| `PATCH /requests/:id/status` | Owner cancellation or reporting-manager decision. |
| `PUT /admin/configuration` | Admin; atomic settings, allowance, and holiday updates. |
| `POST /admin/leave-types` | Admin; adds a type and increments the configuration version. |
| `GET /profile`, `PUT /profile` | Own account details; profile edits are employee-only. |
| `GET /profile/photo`, `POST /profile/photo`, `DELETE /profile/photo` | Own photo; employee-only upload/removal. Upload uses multipart field `photo`. |
| `POST /profile/password` | Authenticated account password change; requires `currentPassword` and `newPassword`, and issues a new session. Open demo sessions are rejected. |
| `GET /admin/people`, `POST /admin/people`, `PUT /admin/people/:id` | Admin people management with leave-history and deactivation safeguards. |
| `POST /admin/teams`, `PUT /admin/teams/:id` | Admin team creation/renaming. |
| `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` | Current user's notifications and read state. |
| `GET /requests/:requestId/documents`, `POST /requests/:requestId/documents` | Authorized document listing; pending-request owners can upload multipart field `files`. |
| `GET /requests/:requestId/documents/:id/file`, `DELETE /requests/:requestId/documents/:id` | Authorized downloads; pending-request owners can remove documents. |

Create/preview body:

```json
{
  "leaveTypeId": "a-valid-leave-type-uuid",
  "startDate": "2026-12-07",
  "endDate": "2026-12-09",
  "reason": "Family time",
  "period": "full"
}
```

`period` defaults to `full` for older clients; use `am` or `pm` with identical start/end dates for half-days. Editing and edit previews use the same fields plus the request's `version`.

Decision body: `{ "status": "approved", "note": "Enjoy your break", "version": 1 }`. Valid statuses are `approved`, `rejected`, and `cancelled`. Older clients may omit a version only for an unedited initial decision or cancellation; stale explicit versions are rejected.

Errors use a meaningful HTTP status and `message`: `400` invalid input/notice, `401` missing or invalid session, `403` forbidden role/report/origin, `404` missing record, `409` balance/overlap/coverage/state/version conflict, and `503` a failed database operation. Validation messages may be an array. Unexpected failures are not disguised as successful responses.

## Tests and verification

Install host dependencies with `npm ci` first.

```shell
npm run test:unit
```

This runs the fast API domain/workflow tests with fakes and the Angular component/HTTP tests without a database or network service.

For the complete test suite and **80% minimum statement, branch, function, and line coverage**:

```shell
docker compose up -d --wait db
npm test
```

The API integration suite creates a uniquely named schema in the configured PostgreSQL database, applies migrations and seed data there, starts an ephemeral API, tests real HTTP and concurrent transactions, and removes only that schema. It does **not** truncate the app's public/demo tables. The database user needs permission to create schemas. Never point development tests at a production database.

Additional checks:

```shell
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

Coverage reports are under `apps/api/coverage` and `apps/web/coverage`. Tests cover calendar boundaries, half-day overlap/capacity, carry-over expiry/funding, versioned edits, reminders, durable delivery retries, real SMTP against a local double, ICS escaping, monthly analytics, and existing leave/account workflows. SMTP tests send only to a local in-memory test server, never external recipients. Scheduled jobs default off in tests.

**Development dependency finding:** `npm ls --all` currently reports an optional Chokidar peer-version conflict between the Angular and NestJS development toolchains, which require different watcher generations. Production builds and application tests pass, but that does not make the dependency-tree check clean. Align compatible toolchain releases rather than forcing one watcher version across both stacks.

GitHub Actions runs install, lint, builds, type checking, and the complete test suite against an ephemeral PostgreSQL service, then retains coverage reports. It does not automatically deploy or publish images.

### Generated files and cleanup

Local `dist/`, `coverage/`, and `*.tsbuildinfo` are reproducible build/test outputs, not source. Run `npm run build` to regenerate builds before invoking workspace commands that need compiled output; the test commands above recreate their reports.

Do not delete `packages/contracts/dist` or `apps/web/.angular` while a local development server is running: the server can depend on the compiled shared contracts and Angular cache. Preserve `.env`, dependency installations, and the PostgreSQL volume when cleaning build/test output.

## Deployment and scope

- This is a working project/demo baseline, not a claim of production certification.
- Keep `DEMO_LOGIN_ENABLED=false` outside an explicitly public demo dataset. Demo Admin access intentionally allows visitors to edit the shared demo configuration.
- For deployment, use HTTPS, `COOKIE_SECURE=true`, a strong unique secret, the correct origin, managed database credentials/backups, and a trusted reverse proxy. The Docker ports intentionally bind only to localhost.
- Production uses an external stylesheet instead of Angular's inline critical-CSS loader, so Nginx can enforce a script policy without `unsafe-inline`.
- Sessions last eight hours. Password changes invalidate older sessions, and inactive accounts cannot authenticate. Logout clears the browser cookie but does not revoke a copied JWT. A production rollout should add logout revocation, password reset, and account recovery.
- The demo's rate limiter is process-local. Use a shared limiter before scaling across API instances.
- Accrual, prorating, arbitrary hourly leave, AI integrations, automatic calendar subscriptions, and external holiday synchronization are outside this baseline. Uploaded documents are content-type checked but do not yet have a malware-scanning service.
- To submit, publish this initialized local repository to your own Git host and share its URL. Keep `.env`, generated builds, and dependencies out of the source commit.

## Release notes

**Leave planning update:** AM/PM half-days, versioned pending-request edits, daily approval reminders, optional SMTP notification delivery, carry-over from 2027, ICS exports, and role-scoped monthly analytics. Dark mode and the removed profile-photo controls are not included.

**Account page simplification:** removed the Profile photo panel and its upload/removal controls. Personal details, password settings, existing avatars, and supporting-document uploads are unchanged.

**OFFZONE update:** application name and logo updated across the browser tab, sign-in page, workspace, and footer. Includes employee profiles/photos, password/session management, admin people/teams, in-app notifications, supporting documents, CSV exports, and team insights. Existing leave records and database volumes are preserved.

**Demo sign-in update:** opt-in portal selection, an Important note below the login button, dummy-credential access to fixed seeded accounts, and preserved password-based account sign-in.

**1.0.0:** complete baseline with server-enforced roles, transaction-safe reservation rules, cancellation restoration, admin configuration, seeded data, responsive dashboards, tests, and Docker setup.
