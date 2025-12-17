let binary = "usc";

export class Logger {
  public readonly namespace: string;
  public verbose: boolean = false;

  public constructor(namespace: string = "", verbose: boolean = false) {
    this.namespace = namespace;
    this.verbose = verbose;
  }

  private addNamespace(args: unknown[]): void {
    if (this.namespace) {
      args.unshift(`${binary} [${this.namespace}]`);
    }
    else {
      args.unshift(binary);
    }
  }

  public setVerbose(v: boolean): void {
    this.verbose = v;
  }

  public debug(...args: unknown[]): void {
    if (this.verbose) {
      this.addNamespace(args);
      console.debug(...args);
    }
  }

  public info(...args: unknown[]): void {
    this.addNamespace(args);
    console.info(...args);
  }

  public warn(...args: unknown[]): void {
    this.addNamespace(args);
    console.warn(...args);
  }

  public error(...args: unknown[]) {
    this.addNamespace(args);
    console.error(...args);
  }
}

/**
 * Global logger instance; generally use this unless you need a namespaced logger.
 */
export const logger = new Logger();
