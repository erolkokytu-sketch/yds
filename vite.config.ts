import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

async function walk(directory: string, root = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path, root) : [path.slice(root.length + 1).replaceAll("\\", "/")];
  }));
  return files.flat();
}

function pwaBuildPlugin(appName: string, shortName: string): Plugin {
  let outputDirectory = "dist";
  let base = "/";
  return {
    name: "yds-pwa-build",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    async closeBundle() {
      await mkdir(outputDirectory, { recursive: true });
      const manifest = {
        id: "./",
        name: appName,
        short_name: shortName,
        description: "Yerel ve çevrimdışı çalışan YDS çalışma uygulaması",
        lang: "tr",
        start_url: "./#/",
        scope: "./",
        display: "standalone",
        orientation: "any",
        theme_color: "#205c4a",
        background_color: "#f4f2ec",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      await writeFile(resolve(outputDirectory, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);

      const files = (await walk(outputDirectory))
        .filter((file) => file !== "sw.js" && !file.endsWith(".map"))
        .sort();
      const digest = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 10);
      const cacheName = `yds-shell-${packageJson.version}-${digest}`;
      const urls = files.map((file) => `${base}${file}`.replace(/\/+/g, "/"));
      const serviceWorker = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_SHELL = ${JSON.stringify(urls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("yds-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(new URL("./index.html", self.registration.scope), { ignoreVary: true })));
    return;
  }
  event.respondWith(caches.match(event.request, { ignoreVary: true }).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
`;
      await writeFile(resolve(outputDirectory, "sw.js"), serviceWorker);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appName = env.VITE_APP_NAME || "YDS Çalışma";
  const shortName = env.VITE_APP_SHORT_NAME || "YDS Çalışma";
  return {
    base: env.VITE_BASE_PATH || "/",
    define: {
      __APP_NAME__: JSON.stringify(appName),
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    plugins: [
      react(),
      {
        name: "yds-html-title",
        transformIndexHtml(html) {
          return html.replaceAll("%APP_NAME%", appName);
        },
      },
      pwaBuildPlugin(appName, shortName),
    ],
    test: {
      environment: "jsdom",
      setupFiles: ["./test/ui/setup.ts"],
      include: ["test/ui/**/*.test.ts", "test/ui/**/*.test.tsx"],
      css: true,
    },
  };
});
