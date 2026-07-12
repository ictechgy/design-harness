import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

export async function startLocalFixtureServer(rootDir) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodePathname(requestUrl.pathname, response);
    if (!pathname) {
      return;
    }
    const candidate = safeJoin(rootDir, pathname);
    if (!candidate || !existsSync(candidate) || !statSync(candidate).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mimeType(candidate) });
    createReadStream(candidate).pipe(response);
  });

  await new Promise((resolveListen, rejectListen) => {
    const reject = (error) => rejectListen(error);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Fixture server did not expose a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  };
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

function decodePathname(pathname, response) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return null;
  }
}

function safeJoin(rootDir, pathname) {
  const fullPath = normalize(join(rootDir, pathname));
  return fullPath === rootDir || fullPath.startsWith(`${rootDir}${sep}`) ? fullPath : null;
}

function mimeType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
