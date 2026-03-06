const esbuild = require("esbuild");

// Stub plugin: provides empty modules for Node.js built-ins that
// aren't available in the browser. Features using these (git push,
// .env file sync, project detection) gracefully degrade.
const nodeStubPlugin = {
  name: "node-stub",
  setup(build) {
    const stubs = ["fs", "path", "child_process", "os", "net", "tls", "url"];
    for (const mod of stubs) {
      build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
        path: mod,
        namespace: "node-stub",
      }));
    }
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      contents: "module.exports = new Proxy({}, { get: () => () => { throw new Error('Not available in web'); } });",
      loader: "js",
    }));
  },
};

esbuild
  .build({
    entryPoints: ["./src/extension.ts"],
    bundle: true,
    outfile: "dist/web-extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "browser",
    minify: true,
    plugins: [nodeStubPlugin],
    define: {
      global: "globalThis",
    },
  })
  .then(() => console.log("  dist/web-extension.js  ✓"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
