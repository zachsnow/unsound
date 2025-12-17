let binary = "usc";
export class Logger {
  private readonly namespace: string;
  private verbose: boolean = false;
  private color: boolean = true;

  public constructor(namespace: string = "", verbose: boolean = false, color: boolean = true) {
    this.namespace = namespace;
    this.verbose = verbose;
    this.color = color;
  }

  private addNamespace(args: unknown[]): void {
    if (this.namespace) {
      args.unshift(`${binary} [${this.namespace}]`);
    }
    else {
      args.unshift(binary);
    }
  }

  /**
   * Colorize all string arguments.
   */
  private colorize(args: unknown[], colorFn: (s: string) => string = (s) => s): void {
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === "string") {
        args[i] = colorFn(args[i] as string);
      }
    }
  }

  public green = (s: string): string => this.color ? `\x1b[32m${s}\x1b[0m` : s;
  public red = (s: string): string => this.color ? `\x1b[31m${s}\x1b[0m` : s;
  public dim = (s: string): string => this.color ? `\x1b[2m${s}\x1b[0m` : s;
  public yellow = (s: string): string => this.color ? `\x1b[33m${s}\x1b[0m` : s;

  public setVerbose(v: boolean): void {
    this.verbose = v;
  }

  public debug(...args: unknown[]): void {
    if (this.verbose) {
      this.addNamespace(args);
      this.colorize(args, this.dim);
      console.debug(...args);
    }
  }

  public info(...args: unknown[]): void {
    this.addNamespace(args);
    console.info(...args);
  }

  public success(...args: unknown[]): void {
    this.addNamespace(args);
    this.colorize(args, this.green);
    console.info(...args);
  }

  public warn(...args: unknown[]): void {
    this.addNamespace(args);
    this.colorize(args, this.yellow);
    console.warn(...args);
  }

  public error(...args: unknown[]) {
    this.addNamespace(args);
    this.colorize(args, this.red);
    console.error(...args);
  }
}

/**
 * Global logger instance; generally use this unless you need a namespaced logger.
 */
export const logger = new Logger();
