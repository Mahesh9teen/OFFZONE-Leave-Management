# Leave Management API

NestJS/TypeScript API with PostgreSQL transactions, Zod request validation, cookie authentication, and server-side role/report checks.

Open demo sign-in is opt-in through `DEMO_LOGIN_ENABLED=true`. `GET /api/auth/options` exposes that flag; `POST /api/auth/demo-login` accepts only a validated role and uses its fixed seeded account. Demo sessions are tagged and rejected when the flag is disabled. The existing password login remains unchanged.

See the [root README](../../README.md) for setup, environment variables, business policies, architecture, data model, endpoint contracts, and the demo.

Run commands from the repository root:

```shell
npm run build --workspace @leave/contracts
npm run build --workspace @leave/api
npm run db:migrate
npm run db:seed
npm run start:dev --workspace @leave/api
```

`npm test --workspace @leave/api` runs hermetic unit tests. `npm run test:cov --workspace @leave/api` includes isolated PostgreSQL/API integration tests and enforces coverage thresholds. Development and database commands load the root `.env`; test database settings are described in the root README.

Pure policies live in [src/domain/rules.ts](src/domain/rules.ts). [src/leave.service.ts](src/leave.service.ts) coordinates them through a repository boundary; [src/db/leave.repository.ts](src/db/leave.repository.ts) implements the transaction and row-lock protocol.
