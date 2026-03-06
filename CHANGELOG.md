# Changelog

All notable changes to the Cloud Hosting Deploy & Manage by MassiveGRID extension will be documented in this file.

## [0.0.3] - 2026-03-06

### Fixed
- Updated marketplace search text to match new display name
- Improved README documentation with VS Code Web section and requirements

### Changed
- Updated README and CHANGELOG to reflect fresh versioning from v0.0.1

## [0.0.2] - 2026-03-06

### Added
- VS Code Web support (vscode.dev and GitHub Codespaces)
- Browser entry point with fetch-based API client

### Fixed
- Refresh icon sizing in webview panels
- Screenshot images not loading on VS Code Marketplace

### Changed
- Replaced Node.js http/https with fetch API for cross-platform compatibility
- Updated README with VS Code Web documentation

## [0.0.1] - 2026-03-05

### Added
- Initial public release on VS Code Marketplace
- Server management (add, remove, switch active server)
- Project and application management
- Deploy, start, stop, redeploy applications
- Push & Deploy workflow (git push + deploy)
- Application Detail panel with 10 tabs: General, Environment, Domains, Deployments, Preview Deployments, Schedules, Volume Backups, Logs, Monitoring, Advanced
- Compose Detail panel with full tabbed interface
- Compose domain management
- Database commands (start, stop, copy connection string)
- Environment variable management with local .env sync
- Domain management with SSL support
- Real-time log streaming
- Docker Compose support (create, edit, deploy)
- Templates marketplace
- Dashboard overview
