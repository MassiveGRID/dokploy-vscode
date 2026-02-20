# Dokploy - Deploy & Manage

A Visual Studio Code extension that allows you to deploy your code to Dokploy servers directly from VS Code. Create services, manage deployments, view logs, and configure domains seamlessly.

## Features

- **Server Management**: Connect and manage your Dokploy servers
- **Project & Service Management**: Create and manage projects and services
- **Deployment**: Deploy your code with ease
- **Logs Viewing**: Monitor deployment logs in real-time
- **Environment & Domains**: Configure environment variables and domains
- **Push Deploy**: Quick deployment from your workspace
- **Docker Compose Support**: Work with Docker Compose files

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Dokploy - Deploy & Manage"
4. Click Install

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/Massivegrid/dokploy-vscode.git
   cd dokploy-vscode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Install the extension in VS Code:
   - Open VS Code
   - Go to Extensions > Install from VSIX
   - Select the generated `.vsix` file

## Usage

After installation, you'll see the Dokploy icon in the Activity Bar. Click it to access:

- **Servers**: Manage your Dokploy servers
- **Projects & Services**: View and manage your projects and services

Use the command palette (Ctrl+Shift+P) to access Dokploy commands:
- `Dokploy: Deploy`
- `Dokploy: View Logs`
- `Dokploy: Configure Domains`
- And more...

## Requirements

- VS Code 1.109.0 or higher
- A Dokploy server instance

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Repository

[GitHub Repository](https://github.com/Massivegrid/dokploy-vscode)
