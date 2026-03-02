# Dokploy VSCode Extension

VS Code extension for managing Dokploy self-hosted PaaS servers.

## Build & Dev Commands

```bash
npm run build    # Production build (esbuild → dist/extension.js)
npm run watch    # Watch mode for development
npm run lint     # Type-check only (tsc --noEmit), no test runner configured
```

To package the extension:
```bash
npx vsce package
```

## Project Structure

```
src/
  extension.ts          # Entry point — registers all commands and views
  api/
    client.ts           # DokployClient HTTP class + all TypeScript interfaces
    serverManager.ts    # Manages multiple server connections (add/remove/list)
  commands/
    deploy.ts           # Deploy, start, stop, redeploy application
    compose.ts          # Compose service commands (deploy, start, stop, edit)
    database.ts         # Database commands (start, stop, copy connection string)
    envAndDomains.ts    # Manage env vars and domains
    logs.ts             # View logs
    projects.ts         # Create/delete projects and applications
    pushDeploy.ts       # Git push + deploy workflow
    templates.ts        # Browse and deploy templates marketplace
  views/
    appDetail.ts        # Full 10-tab Application Detail webview panel
    dashboard.ts        # Overview dashboard webview
    projectsTree.ts     # Tree view: projects → applications / compose / databases
    serversTree.ts      # Tree view: servers list
    templates.ts        # Templates marketplace webview
dist/
  extension.js          # Bundled output (do not edit directly)
```

## Architecture

- **Two tree views** registered in the activity bar: `dokploy.servers` and `dokploy.projects`
- **Tree item types**: `server`, `project`, `application`, `compose`, `database`
- Clicking an `ApplicationTreeItem` fires `dokploy.openAppDetail` → opens `AppDetailPanel`
- Commands are grouped by concern in `src/commands/` and registered in `extension.ts`
- All API calls go through `DokployClient` in `src/api/client.ts`
- No test framework is configured — use `npm run lint` to validate types

## AppDetailPanel Tabs

All 10 tabs are implemented in [src/views/appDetail.ts](src/views/appDetail.ts):
General, Environment, Domains, Deployments, Preview Deployments, Schedules, Volume Backups, Logs, Monitoring, Advanced

## Key Conventions

- **TypeScript strict mode** is enabled — all types must be explicit
- **Bundler**: esbuild (CommonJS output, Node platform, minified in production)
- **VS Code API version**: `^1.109.0`
- **No runtime dependencies** — only `devDependencies` (types, esbuild, vsce, typescript)
- When adding a new command: register it in `package.json` contributes → commands + menus, then implement in the relevant `src/commands/` file, and register the handler in `src/extension.ts`
- When adding a new API method: add it to `DokployClient` in `src/api/client.ts` alongside the relevant TypeScript interface

## API Notes

- `DokployClient` wraps the Dokploy REST API with typed methods
- Monitoring uses `appName` (not `applicationId`) as the identifier
- Key method groups: schedules, backups, preview deployments, monitoring (see `client.ts`)
