export function assertLocalHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid URL: ${input}. Only http(s) URLs are supported.`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost");

  if (!isLocal) {
    throw new Error(`Invalid URL: ${input}. v0.1 only audits local URLs.`);
  }

  return parsed.toString();
}
