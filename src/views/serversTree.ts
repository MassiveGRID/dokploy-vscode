import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { DokployServer } from "../api/client";

export class ServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly server: DokployServer,
    public readonly isActive: boolean
  ) {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "server";
    this.description = new URL(server.url).hostname;
    this.iconPath = new vscode.ThemeIcon(
      isActive ? "vm-active" : "vm"
    );
    this.tooltip = `${server.name}\n${server.url}\n${isActive ? "(active)" : ""}`;

    if (!isActive) {
      this.command = {
        command: "dokploy.setActiveServer",
        title: "Set as Active",
        arguments: [server.name],
      };
    }
  }
}

export class ServersTreeProvider
  implements vscode.TreeDataProvider<ServerTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ServerTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private serverManager: ServerManager) {
    serverManager.onDidChangeServers(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ServerTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ServerTreeItem[] {
    const servers = this.serverManager.getServers();
    const active = this.serverManager.getActiveServer();

    if (servers.length === 0) {
      return [];
    }

    return servers.map(
      (s) => new ServerTreeItem(s, s.name === active?.name)
    );
  }
}
