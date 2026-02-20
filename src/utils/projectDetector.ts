import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export interface ProjectInfo {
  type: string;
  buildType: string;
  port: number;
  buildCommand?: string;
  startCommand?: string;
  framework?: string;
}

/**
 * Auto-detect project type from workspace files to configure
 * sensible Dokploy build defaults.
 */
export async function detectProject(
  workspacePath: string
): Promise<ProjectInfo> {
  const exists = (file: string) =>
    fs.existsSync(path.join(workspacePath, file));
  const readJson = (file: string) => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(workspacePath, file), "utf-8")
      );
    } catch {
      return null;
    }
  };

  // Check for Dockerfile first — takes priority
  if (exists("Dockerfile")) {
    return {
      type: "docker",
      buildType: "dockerfile",
      port: 3000,
      framework: "Docker",
    };
  }

  // ── Node.js ecosystem ──
  if (exists("package.json")) {
    const pkg = readJson("package.json");
    const deps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
    };

    // Next.js
    if (deps?.next) {
      return {
        type: "nodejs",
        buildType: "nixpacks",
        port: 3000,
        framework: "Next.js",
        buildCommand: "npm run build",
        startCommand: "npm start",
      };
    }

    // Nuxt
    if (deps?.nuxt) {
      return {
        type: "nodejs",
        buildType: "nixpacks",
        port: 3000,
        framework: "Nuxt",
        buildCommand: "npm run build",
        startCommand: "npm run preview",
      };
    }

    // Remix
    if (deps?.["@remix-run/react"]) {
      return {
        type: "nodejs",
        buildType: "nixpacks",
        port: 3000,
        framework: "Remix",
        buildCommand: "npm run build",
        startCommand: "npm start",
      };
    }

    // Astro
    if (deps?.astro) {
      return {
        type: "nodejs",
        buildType: "nixpacks",
        port: 4321,
        framework: "Astro",
        buildCommand: "npm run build",
        startCommand: "npm run preview",
      };
    }

    // Vite / React / Vue SPA
    if (deps?.vite) {
      return {
        type: "static",
        buildType: "nixpacks",
        port: 80,
        framework: "Vite SPA",
        buildCommand: "npm run build",
      };
    }

    // Express / generic Node
    if (deps?.express || deps?.fastify || deps?.koa) {
      const framework = deps?.express
        ? "Express"
        : deps?.fastify
        ? "Fastify"
        : "Koa";
      return {
        type: "nodejs",
        buildType: "nixpacks",
        port: 3000,
        framework,
        startCommand: pkg?.scripts?.start ? "npm start" : "node index.js",
      };
    }

    // Generic Node.js
    return {
      type: "nodejs",
      buildType: "nixpacks",
      port: 3000,
      framework: "Node.js",
      startCommand: pkg?.scripts?.start ? "npm start" : "node index.js",
    };
  }

  // ── Python ──
  if (exists("requirements.txt") || exists("pyproject.toml") || exists("Pipfile")) {
    if (exists("manage.py")) {
      return {
        type: "python",
        buildType: "nixpacks",
        port: 8000,
        framework: "Django",
      };
    }
    const reqContent = exists("requirements.txt")
      ? fs.readFileSync(path.join(workspacePath, "requirements.txt"), "utf-8")
      : "";
    if (reqContent.includes("flask") || reqContent.includes("Flask")) {
      return {
        type: "python",
        buildType: "nixpacks",
        port: 5000,
        framework: "Flask",
      };
    }
    if (reqContent.includes("fastapi") || reqContent.includes("FastAPI")) {
      return {
        type: "python",
        buildType: "nixpacks",
        port: 8000,
        framework: "FastAPI",
      };
    }
    return {
      type: "python",
      buildType: "nixpacks",
      port: 8000,
      framework: "Python",
    };
  }

  // ── Go ──
  if (exists("go.mod")) {
    return {
      type: "go",
      buildType: "nixpacks",
      port: 8080,
      framework: "Go",
    };
  }

  // ── PHP / Laravel / WordPress ──
  if (exists("composer.json")) {
    if (exists("artisan")) {
      return {
        type: "php",
        buildType: "nixpacks",
        port: 8000,
        framework: "Laravel",
      };
    }
    if (exists("wp-config.php") || exists("wp-content")) {
      return {
        type: "php",
        buildType: "dockerfile",
        port: 80,
        framework: "WordPress",
      };
    }
    return {
      type: "php",
      buildType: "nixpacks",
      port: 80,
      framework: "PHP",
    };
  }

  // ── Ruby ──
  if (exists("Gemfile")) {
    if (exists("config.ru") || exists("bin/rails")) {
      return {
        type: "ruby",
        buildType: "nixpacks",
        port: 3000,
        framework: "Rails",
      };
    }
    return {
      type: "ruby",
      buildType: "nixpacks",
      port: 3000,
      framework: "Ruby",
    };
  }

  // ── Rust ──
  if (exists("Cargo.toml")) {
    return {
      type: "rust",
      buildType: "nixpacks",
      port: 8080,
      framework: "Rust",
    };
  }

  // ── Static site ──
  if (exists("index.html")) {
    return {
      type: "static",
      buildType: "static",
      port: 80,
      framework: "Static HTML",
    };
  }

  // Fallback
  return {
    type: "unknown",
    buildType: "nixpacks",
    port: 3000,
    framework: "Unknown",
  };
}
