export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

export class AuditNavigationError extends Error {
  constructor(
    message: string,
    public readonly failedChecks: string[] = []
  ) {
    super(message);
    this.name = "AuditNavigationError";
  }
}
