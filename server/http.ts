import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SkillLibrary, LibraryError, type Tool } from "./library.ts";

import { Marketplaces } from "./marketplaces.ts";

export function createServer(library: SkillLibrary, webDir: string) {
  const marketplaces = new Marketplaces(library);
  const token = randomBytes(32).toString("hex");
  const send = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
        throw new LibraryError(
          "This server only accepts local connections.",
          403,
        );
      const url = new URL(req.url ?? "/", "http://" + host);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== "http://" + host &&
        origin !== "http://127.0.0.1:4317" &&
        origin !== "http://localhost:4317"
      )
        throw new LibraryError(
          "Open Skill Library from its local address.",
          403,
        );
      if (url.pathname === "/api/session" && req.method === "GET")
        return send(res, 200, { token });
      if (url.pathname === "/api/runtime" && req.method === "GET")
        return send(res, 200, { pid: process.pid, state: library.state });
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "GET") {
          const supplied = req.headers["x-skill-library-token"];
          if (
            typeof supplied !== "string" ||
            supplied.length !== token.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
          )
            throw new LibraryError(
              "Session expired. Reload Skill Library.",
              403,
            );
          if (req.headers["content-type"] !== "application/json")
            throw new LibraryError("Expected JSON.", 415);
        }
        if (url.pathname === "/api/inventory" && req.method === "GET") {
          const inventory = library.inventory();
          return send(res, 200, {
            ...inventory,
            skills: inventory.skills.map((s) => ({
              ...s,
              variants: s.variants.map(
                ({ content: _content, ...variant }) => variant,
              ),
            })),
          });
        }
        if (url.pathname === "/api/history" && req.method === "GET")
          return send(
            res,
            200,
            library
              .history()
              .map(
                ({
                  snapshots: _snapshots,
                  manifestBefore: _manifest,
                  ...operation
                }) => operation,
              ),
          );
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            throw new LibraryError("Request is too large.", 413);
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            throw new LibraryError("Invalid JSON.");
          }
        }
        const string = (key: string) => {
          if (typeof body[key] !== "string")
            throw new LibraryError("Missing field: " + key);
          return body[key] as string;
        };
        if (url.pathname === "/api/marketplaces") {
          if (req.method === "GET") return send(res, 200, marketplaces.list());
          if (req.method === "POST")
            return send(res, 201, await marketplaces.add(string("url")));
        }
        const marketplaceMatch = url.pathname.match(
          /^\/api\/marketplaces\/([a-f0-9]{16})(?:\/skills\/([a-f0-9]{16}))?$/,
        );
        if (marketplaceMatch) {
          const [, id, skillId] = marketplaceMatch;
          if (req.method === "GET")
            return send(
              res,
              200,
              skillId
                ? marketplaces.preview(id, skillId)
                : marketplaces.catalogue(id),
            );
          if (req.method === "DELETE" && !skillId) {
            marketplaces.remove(id);
            return send(res, 200, { removed: true });
          }
          if (req.method === "POST" && skillId)
            return send(
              res,
              201,
              marketplaces.install(
                id,
                skillId,
                string("hash"),
                body.tools as Tool[],
              ),
            );
        }
        const match = url.pathname.match(
          /^\/api\/skills\/([^/]+)(?:\/(detail|files|file|plan|share|enabled))?$/,
        );
        if (match) {
          const name = decodeURIComponent(match[1]),
            action = match[2] ?? "detail";
          if (req.method === "GET") {
            if (action === "detail")
              return send(res, 200, library.detail(name));
            if (action === "files")
              return send(
                res,
                200,
                library.files(name, url.searchParams.get("source") ?? "shared"),
              );
            if (action === "file")
              return send(
                res,
                200,
                library.readFile(
                  name,
                  url.searchParams.get("source") ?? "shared",
                  url.searchParams.get("file") ?? "SKILL.md",
                ),
              );
          }
          if (req.method === "POST") {
            if (action === "plan")
              return send(
                res,
                200,
                library.plan(
                  name,
                  string("source"),
                  string("revision"),
                  body.tools as Tool[],
                ),
              );
            if (action === "share")
              return send(
                res,
                200,
                library.share(
                  name,
                  string("source"),
                  string("revision"),
                  body.tools as Tool[],
                ),
              );
            if (action === "enabled") {
              if (typeof body.enabled !== "boolean")
                throw new LibraryError("Missing enabled state.");
              return send(
                res,
                200,
                library.setEnabled(
                  name,
                  string("tool") as Tool,
                  body.enabled,
                  string("revision"),
                ),
              );
            }
          }
          if (req.method === "PUT" && action === "file")
            return send(
              res,
              200,
              library.saveFile(
                name,
                string("source"),
                string("file"),
                string("content"),
                string("revision"),
              ),
            );
        }
        if (url.pathname === "/api/skills" && req.method === "POST")
          return send(
            res,
            201,
            library.create(
              string("name"),
              string("description"),
              string("body"),
              body.tools as Tool[],
            ),
          );
        if (url.pathname === "/api/restore" && req.method === "POST")
          return send(res, 200, library.restore(string("id")));
        throw new LibraryError("Route not found.", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new LibraryError("Method not allowed.", 405);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (relative.split("/").some((p) => p === ".." || p.startsWith(".")))
        throw new LibraryError("Invalid path.", 400);
      let p = path.resolve(webDir, relative || "index.html");
      if (!p.startsWith(path.resolve(webDir) + path.sep))
        throw new LibraryError("Invalid path.", 400);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory())
        p = path.join(webDir, "index.html");
      if (!fs.existsSync(p))
        throw new LibraryError("Web UI is not built. Run npm run build.", 503);
      const type: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": type[path.extname(p)] ?? "application/octet-stream",
        "Cache-Control":
          path.extname(p) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end();
      else fs.createReadStream(p).pipe(res);
    } catch (error) {
      send(res, error instanceof LibraryError ? error.status : 500, {
        error: (error as Error).message,
      });
    }
  });
}
