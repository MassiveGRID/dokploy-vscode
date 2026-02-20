import * as https from "https";
import * as http from "http";
import { URL } from "url";

export interface DokployServer {
  name: string;
  url: string;
  apiKey: string;
}

export interface DokployProject {
  projectId: string;
  name: string;
  description: string;
  createdAt: string;
  applications: DokployApplication[];
}

export interface DokployApplication {
  applicationId: string;
  name: string;
  appName: string;
  description: string;
  buildType: string;
  applicationStatus: string;
  projectId: string;
  createdAt: string;
  sourceType: string;
  repository?: string;
  branch?: string;
  dockerImage?: string;
  env?: string;
  memoryReservation?: number;
  memoryLimit?: number;
  cpuReservation?: number;
  cpuLimit?: number;
}

export interface DokployDomain {
  domainId: string;
  host: string;
  path: string;
  port: number;
  https: boolean;
  certificateType: string;
  applicationId: string;
  createdAt: string;
}

export interface DokployDeployment {
  deploymentId: string;
  title: string;
  description: string;
  status: string;
  logPath: string;
  applicationId?: string;
  composeId?: string;
  createdAt: string;
}

export interface DokployCompose {
  composeId: string;
  name: string;
  appName: string;
  description: string;
  composeFile: string;
  composeStatus: string;
  sourceType: string;
  env?: string;
  projectId: string;
  createdAt: string;
}

export class DokployClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(server: DokployServer) {
    // Ensure URL ends with /api if not already
    this.baseUrl = server.url.replace(/\/+$/, "");
    if (!this.baseUrl.endsWith("/api")) {
      this.baseUrl += "/api";
    }
    this.apiKey = server.apiKey;
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      // Allow self-signed certs (common for self-hosted Dokploy)
      rejectUnauthorized: false,
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              const errorBody = data ? JSON.parse(data) : {};
              reject(
                new Error(
                  errorBody.message ||
                    errorBody.error ||
                    `HTTP ${res.statusCode}: ${res.statusMessage}`
                )
              );
              return;
            }
            const parsed = data ? JSON.parse(data) : {};
            resolve(parsed as T);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // ── Auth / Test Connection ──────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      await this.request("GET", "/project.all");
      return true;
    } catch {
      return false;
    }
  }

  // ── Projects ────────────────────────────────────────────────────────

  async getProjects(): Promise<DokployProject[]> {
    return this.request<DokployProject[]>("GET", "/project.all");
  }

  async getProject(projectId: string): Promise<DokployProject> {
    return this.request<DokployProject>(
      "GET",
      `/project.one?projectId=${projectId}`
    );
  }

  async createProject(
    name: string,
    description?: string
  ): Promise<DokployProject> {
    return this.request<DokployProject>("POST", "/project.create", {
      name,
      description: description || "",
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request("POST", "/project.remove", { projectId });
  }

  // ── Applications ────────────────────────────────────────────────────

  async getApplication(applicationId: string): Promise<DokployApplication> {
    return this.request<DokployApplication>(
      "GET",
      `/application.one?applicationId=${applicationId}`
    );
  }

  async createApplication(
    projectId: string,
    name: string,
    appName?: string,
    description?: string
  ): Promise<DokployApplication> {
    // Dokploy requires environmentId — get the default environment for this project
    const project = await this.getProject(projectId);
    const environments = (project as any).environments || [];
    const defaultEnv = environments.find((e: any) => e.isDefault) || environments[0];

    if (!defaultEnv) {
      throw new Error("No environment found for this project");
    }

    const resolvedAppName = appName || name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    return this.request<DokployApplication>("POST", "/application.create", {
      projectId,
      name,
      appName: resolvedAppName,
      description: description || "",
      buildType: "nixpacks",
      environmentId: defaultEnv.environmentId,
    });
  }

  async deleteApplication(applicationId: string): Promise<void> {
    await this.request("POST", "/application.delete", { applicationId });
  }

  async updateApplication(
    applicationId: string,
    updates: Partial<DokployApplication>
  ): Promise<DokployApplication> {
    return this.request<DokployApplication>("POST", "/application.update", {
      applicationId,
      ...updates,
    });
  }

  // ── Deployment ──────────────────────────────────────────────────────

  async deploy(applicationId: string): Promise<void> {
    await this.request("POST", "/application.deploy", { applicationId });
  }

  async redeploy(applicationId: string): Promise<void> {
    await this.request("POST", "/application.redeploy", { applicationId });
  }

  async startApplication(applicationId: string): Promise<void> {
    await this.request("POST", "/application.start", { applicationId });
  }

  async stopApplication(applicationId: string): Promise<void> {
    await this.request("POST", "/application.stop", { applicationId });
  }

  // ── Git Provider ────────────────────────────────────────────────────

  async saveGitProvider(
    applicationId: string,
    repositoryUrl: string,
    branch: string
  ): Promise<void> {
    await this.request("POST", "/application.saveGitProvider", {
      applicationId,
      customGitUrl: repositoryUrl,
      customGitBranch: branch,
    });
  }

  async saveBuildType(
    applicationId: string,
    buildType: string
  ): Promise<void> {
    await this.request("POST", "/application.saveBuildType", {
      applicationId,
      buildType,
    });
  }

  // ── Environment Variables ───────────────────────────────────────────

  async saveEnvironment(
    applicationId: string,
    env: string
  ): Promise<void> {
    await this.request("POST", "/application.saveEnvironment", {
      applicationId,
      env,
    });
  }

  // ── Domains ─────────────────────────────────────────────────────────

  async getDomains(applicationId: string): Promise<DokployDomain[]> {
    return this.request<DokployDomain[]>(
      "GET",
      `/domain.byApplicationId?applicationId=${applicationId}`
    );
  }

  async createDomain(
    applicationId: string,
    host: string,
    port: number = 3000,
    https: boolean = true
  ): Promise<DokployDomain> {
    return this.request<DokployDomain>("POST", "/domain.create", {
      applicationId,
      host,
      path: "/",
      port,
      https,
      certificateType: https ? "letsencrypt" : "none",
    });
  }

  async deleteDomain(domainId: string): Promise<void> {
    await this.request("POST", "/domain.delete", { domainId });
  }

  async generateDomain(
    applicationId: string
  ): Promise<{ domain: string }> {
    return this.request("POST", "/domain.generateDomain", {
      applicationId,
    });
  }

  // ── Deployments ───────────────────────────────────────────────────

  async getDeployments(applicationId: string): Promise<DokployDeployment[]> {
    return this.request<DokployDeployment[]>(
      "GET",
      `/deployment.all?applicationId=${applicationId}`
    );
  }

  async getDeploymentsByCompose(composeId: string): Promise<DokployDeployment[]> {
    return this.request<DokployDeployment[]>(
      "GET",
      `/deployment.allByCompose?composeId=${composeId}`
    );
  }

  async cancelDeployment(applicationId: string): Promise<void> {
    await this.request("POST", "/application.cancelDeployment", { applicationId });
  }

  // ── Application Monitoring ────────────────────────────────────────

  async readAppMonitoring(applicationId: string): Promise<any> {
    return this.request("GET", `/application.readAppMonitoring?applicationId=${applicationId}`);
  }

  // ── Compose ───────────────────────────────────────────────────────

  async createCompose(
    projectId: string,
    name: string,
    appName?: string,
    description?: string,
    composeFile?: string
  ): Promise<DokployCompose> {
    const project = await this.getProject(projectId);
    const environments = (project as any).environments || [];
    const defaultEnv = environments.find((e: any) => e.isDefault) || environments[0];

    if (!defaultEnv) {
      throw new Error("No environment found for this project");
    }

    const resolvedAppName = appName || name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    return this.request<DokployCompose>("POST", "/compose.create", {
      projectId,
      name,
      appName: resolvedAppName,
      description: description || "",
      composeType: "docker-compose",
      environmentId: defaultEnv.environmentId,
    });
  }

  async getCompose(composeId: string): Promise<DokployCompose> {
    return this.request<DokployCompose>("GET", `/compose.one?composeId=${composeId}`);
  }

  async updateCompose(composeId: string, updates: Partial<DokployCompose>): Promise<DokployCompose> {
    return this.request<DokployCompose>("POST", "/compose.update", {
      composeId,
      ...updates,
    });
  }

  async deleteCompose(composeId: string): Promise<void> {
    await this.request("POST", "/compose.delete", { composeId });
  }

  async deployCompose(composeId: string): Promise<void> {
    await this.request("POST", "/compose.deploy", { composeId });
  }

  async redeployCompose(composeId: string): Promise<void> {
    await this.request("POST", "/compose.redeploy", { composeId });
  }

  async startCompose(composeId: string): Promise<void> {
    await this.request("POST", "/compose.start", { composeId });
  }

  async stopCompose(composeId: string): Promise<void> {
    await this.request("POST", "/compose.stop", { composeId });
  }

  async saveComposeEnvironment(composeId: string, env: string): Promise<void> {
    await this.request("POST", "/compose.update", { composeId, env });
  }

  async saveComposeFile(composeId: string, composeFile: string): Promise<void> {
    await this.request("POST", "/compose.update", { composeId, composeFile });
  }

  // ── Utility ───────────────────────────────────────────────────────

  getBaseUrl(): string {
    return this.baseUrl.replace(/\/api\/?$/, "");
  }
}
