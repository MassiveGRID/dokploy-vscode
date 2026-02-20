import * as vscode from "vscode";
import { DokployClient, DokployServer } from "./client";

const SERVERS_KEY = "dokploy.servers";

export class ServerManager {
  private servers: DokployServer[] = [];
  private clients: Map<string, DokployClient> = new Map();
  private activeServer: DokployServer | undefined;
  private context: vscode.ExtensionContext;

  private _onDidChangeServers = new vscode.EventEmitter<void>();
  readonly onDidChangeServers = this._onDidChangeServers.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadServers();
  }

  private loadServers(): void {
    const stored = this.context.globalState.get<DokployServer[]>(SERVERS_KEY, []);
    this.servers = stored;
    for (const server of this.servers) {
      this.clients.set(server.name, new DokployClient(server));
    }
    if (this.servers.length > 0 && !this.activeServer) {
      this.activeServer = this.servers[0];
    }
  }

  private async saveServers(): Promise<void> {
    await this.context.globalState.update(SERVERS_KEY, this.servers);
  }

  async addServer(): Promise<DokployServer | undefined> {
    const name = await vscode.window.showInputBox({
      prompt: "Server name (e.g., 'production', 'staging')",
      placeHolder: "my-server",
      validateInput: (v) => {
        if (!v.trim()) return "Name is required";
        if (this.servers.some((s) => s.name === v.trim()))
          return "A server with this name already exists";
        return null;
      },
    });
    if (!name) return;

    const url = await vscode.window.showInputBox({
      prompt: "Dokploy server URL",
      placeHolder: "https://your-server.com:3000",
      validateInput: (v) => {
        if (!v.trim()) return "URL is required";
        try {
          new URL(v.trim());
          return null;
        } catch {
          return "Invalid URL";
        }
      },
    });
    if (!url) return;

    const apiKey = await vscode.window.showInputBox({
      prompt: "API Key (from Dokploy Settings > API Keys)",
      password: true,
      validateInput: (v) => (v.trim() ? null : "API key is required"),
    });
    if (!apiKey) return;

    const server: DokployServer = {
      name: name.trim(),
      url: url.trim(),
      apiKey: apiKey.trim(),
    };

    // Store API key securely
    await this.context.secrets.store(
      `dokploy.apiKey.${server.name}`,
      server.apiKey
    );

    // Test connection
    const client = new DokployClient(server);
    const statusMessage = vscode.window.setStatusBarMessage(
      "$(loading~spin) Testing connection to Dokploy..."
    );

    try {
      const connected = await client.testConnection();
      statusMessage.dispose();

      if (!connected) {
        const retry = await vscode.window.showErrorMessage(
          "Could not connect to Dokploy server. Check your URL and API key.",
          "Retry",
          "Save Anyway"
        );
        if (retry === "Retry") {
          return this.addServer();
        }
        if (retry !== "Save Anyway") return;
      } else {
        vscode.window.showInformationMessage(
          `Connected to Dokploy server: ${server.name}`
        );
      }
    } catch (err: any) {
      statusMessage.dispose();
      const action = await vscode.window.showErrorMessage(
        `Connection failed: ${err.message}`,
        "Save Anyway",
        "Cancel"
      );
      if (action !== "Save Anyway") return;
    }

    this.servers.push(server);
    this.clients.set(server.name, client);
    if (!this.activeServer) {
      this.activeServer = server;
    }
    await this.saveServers();
    this._onDidChangeServers.fire();
    return server;
  }

  async removeServer(serverName: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Remove server "${serverName}"?`,
      { modal: true },
      "Remove"
    );
    if (confirm !== "Remove") return;

    this.servers = this.servers.filter((s) => s.name !== serverName);
    this.clients.delete(serverName);
    await this.context.secrets.delete(`dokploy.apiKey.${serverName}`);

    if (this.activeServer?.name === serverName) {
      this.activeServer = this.servers[0];
    }
    await this.saveServers();
    this._onDidChangeServers.fire();
  }

  getServers(): DokployServer[] {
    return [...this.servers];
  }

  getActiveServer(): DokployServer | undefined {
    return this.activeServer;
  }

  setActiveServer(name: string): void {
    const server = this.servers.find((s) => s.name === name);
    if (server) {
      this.activeServer = server;
      this._onDidChangeServers.fire();
    }
  }

  getClient(serverName?: string): DokployClient | undefined {
    const name = serverName || this.activeServer?.name;
    if (!name) return;
    return this.clients.get(name);
  }

  getActiveClient(): DokployClient | undefined {
    return this.getClient();
  }

  dispose(): void {
    this._onDidChangeServers.dispose();
  }
}
