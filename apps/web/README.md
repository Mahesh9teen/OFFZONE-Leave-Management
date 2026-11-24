# OFFZONE web application

Standalone Angular components for employee requests, manager decisions, calendars, balance charts, and admin configuration.

See the [root README](../../README.md) for the complete setup and business rules.

From the repository root:

```shell
npm start --workspace @leave/web
npm test --workspace @leave/web -- --watch=false
npm run build --workspace @leave/web
```

Development runs at `http://localhost:4200` and proxies `/api` to the local NestJS server. Production is served through Nginx on the same origin as the API. Authentication stays in an HttpOnly cookie; no token is stored in browser storage.

When the API explicitly enables demo login, the Welcome back page displays portal choices and an Important note below the sign-in button. Any valid dummy email and non-empty password can be entered; only the chosen role is sent to the demo endpoint. Visitors can switch to normal account credentials. Unavailable sign-in options are reported with a retry action instead of silently enabling demo access.

Components consume [shared contracts](../../packages/contracts/src/index.ts). Tests use fake APIs and Angular's HTTP testing utilities. JSDOM's missing native dialog methods are faked only in tests; browser validation uses real dialogs.
