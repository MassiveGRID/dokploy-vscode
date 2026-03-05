# Cloud Hosting Deploy & Manage by MassiveGRID

Deploy your code to MassiveGRID servers directly from VS Code. Create services, manage deployments, view logs, and configure domains — all without leaving your editor.

## Features

- **Server Management** — Connect and manage multiple MassiveGRID servers
- **Project & Service Management** — Create and manage projects, applications, and compose services
- **One-Click Deploy** — Deploy your code with a single click or via Push & Deploy
- **Application Details** — Full tabbed panel with General, Environment, Domains, Deployments, Logs, Monitoring, and more
- **Compose Support** — Create, edit, and deploy Docker Compose services
- **Database Management** — Start, stop, and copy connection strings for PostgreSQL, MySQL, MariaDB, MongoDB, and Redis
- **Environment Variables** — Edit and sync environment variables between server and local `.env` files
- **Domain Management** — Configure custom domains with SSL/TLS support
- **Real-Time Logs** — Stream deployment and application logs directly in VS Code
- **Templates Marketplace** — Browse and deploy pre-built application templates

## Screenshots

![Screenshot 1](assets/Screenshot%202026-03-05%20at%2015.48.06.png)
![Screenshot 2](assets/Screenshot%202026-03-05%20at%2015.48.26.png)
![Screenshot 3](assets/Screenshot%202026-03-05%20at%2015.48.52.png)
![Screenshot 4](assets/Screenshot%202026-03-05%20at%2015.49.22.png)
![Screenshot 5](assets/Screenshot%202026-03-05%20at%2015.50.48.png)
![Screenshot 6](assets/Screenshot%202026-03-05%20at%2015.51.06.png)
![Screenshot 7](assets/Screenshot%202026-03-05%20at%2015.51.34.png)

## Getting Started

### Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"MassiveGRID Autodeploy"**
4. Click **Install**

### Connect Your Server

1. Click the **MG** icon in the Activity Bar
2. Click the **+** button to add a server
3. Enter your server URL and API key (found in Settings > API Keys on your MassiveGRID dashboard)

## Usage

After connecting a server, you'll see two panels in the sidebar:

- **Servers** — Your connected MassiveGRID servers
- **Projects & Services** — Browse projects, applications, compose services, and databases

### Quick Actions

| Action | How |
|--------|-----|
| Deploy an application | Right-click an app > **Deploy** |
| Push & Deploy | Right-click an app > **Push & Deploy** (git push + deploy) |
| View logs | Right-click an app > **View Logs** |
| Open app details | Click the app name or right-click > **Open Application Details** |
| Manage environment | Right-click an app > **Manage Environment Variables** |
| Manage domains | Right-click an app > **Manage Domains** |

### Command Palette

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) under the **MassiveGRID** category:

- `MassiveGRID: Deploy to MassiveGRID`
- `MassiveGRID: Push & Deploy`
- `MassiveGRID: View Logs`
- `MassiveGRID: Manage Domains`
- `MassiveGRID: Quick Deploy Current Workspace`
- And more...

### Application Detail Panel

Click any application to open its full detail panel with 10 tabs:

- **General** — App info, build settings, source configuration
- **Environment** — Environment variables and build args
- **Domains** — Custom domain and SSL configuration
- **Deployments** — Deployment history with logs
- **Preview Deployments** — Manage preview environments
- **Schedules** — Cron-based scheduled tasks
- **Volume Backups** — Automated backups to S3-compatible storage
- **Logs** — Real-time application logs
- **Monitoring** — CPU, memory, and network metrics
- **Advanced** — Replicas, resource limits, Traefik config

## ⚠️ Requirements

> **Important**: Ensure you have the following prerequisites:

- **VS Code 1.109.0 or higher** - Required for full compatibility
- **A [MassiveGRID](https://portal.massivegrid.com/index.php/store/ha-cloud-servers/2025-ha-cloud-vps-in-new-york?configoption%5B3233%5D=8025548&configoption%5B3241%5D=2&configoption%5B3237%5D=4&configoption%5B3238%5D=96) server** with API access enabled

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `dokploy.defaultBuildType` | Default build type for new applications | `nixpacks` |
| `dokploy.autoDetectProjectType` | Auto-detect project type and configure build settings | `true` |
| `dokploy.showStatusBar` | Show deployment status in the status bar | `true` |

## License

[MIT](LICENSE)
