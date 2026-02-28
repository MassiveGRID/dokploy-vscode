import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import {
  DokployProject,
  DokployApplication,
} from "../api/client";

type TreeNode = ProjectTreeItem | ApplicationTreeItem | ComposeTreeItem | DatabaseTreeItem | MessageItem;

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(public readonly project: DokployProject) {
    super(project.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "project";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.description = project.description || undefined;
    this.tooltip = `Project: ${project.name}\nID: ${project.projectId}\nApps: ${project.applications?.length || 0}`;
  }
}

export class ApplicationTreeItem extends vscode.TreeItem {
  constructor(public readonly application: DokployApplication) {
    super(application.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "application";
    this.description = this.getStatusLabel();
    this.iconPath = this.getStatusIcon();
    this.tooltip = [
      `App: ${application.name}`,
      `Status: ${application.applicationStatus || "unknown"}`,
      `Build: ${application.buildType || "nixpacks"}`,
      application.repository ? `Repo: ${application.repository}` : null,
      application.branch ? `Branch: ${application.branch}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private getStatusLabel(): string {
    const status = this.application.applicationStatus || "idle";
    const buildType = this.application.buildType || "nixpacks";
    return `${status} · ${buildType}`;
  }

  private getStatusIcon(): vscode.ThemeIcon {
    switch (this.application.applicationStatus) {
      case "running":
        return new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      case "done":
        return new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      case "error":
        return new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("testing.iconFailed")
        );
      case "idle":
        return new vscode.ThemeIcon(
          "circle-outline",
          new vscode.ThemeColor("disabledForeground")
        );
      default:
        return new vscode.ThemeIcon("circle-outline");
    }
  }
}

export class ComposeTreeItem extends vscode.TreeItem {
  constructor(public readonly compose: any) {
    super(compose.name || compose.appName || "Compose", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "compose";
    this.description = `compose · ${compose.composeStatus || compose.applicationStatus || "unknown"}`;
    this.iconPath = new vscode.ThemeIcon("layers");
    this.tooltip = `Compose: ${compose.name}\nStatus: ${compose.composeStatus || compose.applicationStatus || "unknown"}`;
  }
}

export class DatabaseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly db: any,
    public readonly dbType: string,
    public readonly dbId: string
  ) {
    super(db.name || db.appName || dbType, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "database";
    this.description = `${dbType} · ${db.applicationStatus || "unknown"}`;
    this.iconPath = new vscode.ThemeIcon("database");
    this.tooltip = `${dbType}: ${db.name}\nStatus: ${db.applicationStatus || "unknown"}`;
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(message: string, command?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    if (command) {
      this.command = {
        command,
        title: message,
      };
    }
  }
}

export class ProjectsTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: DokployProject[] = [];
  private loading = false;

  constructor(private serverManager: ServerManager) {
    serverManager.onDidChangeServers(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.getRootChildren();
    }

    if (element instanceof ProjectTreeItem) {
      // Fetch full project details (project.one)
      const client = this.serverManager.getActiveClient();
      if (!client) return [];

      try {
        const fullProject = await client.getProject(
          element.project.projectId
        );

        const items: TreeNode[] = [];

        // Services are nested inside project.environments[]
        const environments = (fullProject as any).environments || [];
        for (const env of environments) {
          // Applications
          const apps = env.applications || [];
          for (const app of apps) {
            items.push(new ApplicationTreeItem(app));
          }

          // Compose services
          const compose = env.compose || [];
          for (const comp of compose) {
            items.push(new ComposeTreeItem(comp));
          }

          // Database services
          const dbTypes = ["postgres", "mysql", "mariadb", "mongo", "redis"];
          for (const dbType of dbTypes) {
            const dbs = env[dbType] || [];
            for (const db of dbs) {
              const idField = `${dbType}Id`;
              items.push(new DatabaseTreeItem(db, dbType, db[idField] || ""));
            }
          }
        }

        if (items.length === 0) {
          return [new MessageItem("No services yet")];
        }
        return items;
      } catch (err: any) {
        return [new MessageItem(`Error loading services: ${err.message}`)];
      }
    }

    return [];
  }

  private async getRootChildren(): Promise<TreeNode[]> {
    const client = this.serverManager.getActiveClient();
    if (!client) {
      return [
        new MessageItem("Add a server to get started", "dokploy.addServer"),
      ];
    }

    if (this.loading) {
      return [new MessageItem("Loading...")];
    }

    try {
      this.loading = true;
      this.projects = await client.getProjects();
      this.loading = false;

      if (this.projects.length === 0) {
        return [
          new MessageItem(
            "No projects found. Create one!",
            "dokploy.createProject"
          ),
        ];
      }

      return this.projects.map((p) => new ProjectTreeItem(p));
    } catch (err: any) {
      this.loading = false;
      return [new MessageItem(`Error: ${err.message}`)];
    }
  }
}
