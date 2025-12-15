let verbose = false;

export const setVerbose = (v: boolean) => {
  verbose = v;
};

let binary = "usc";

export const setBinary = (b: string) => {
  binary = b;
}

export class Logger {
  public readonly namespace: string;

  public constructor(namespace: string = "") {
    this.namespace = namespace;
  }

  private addNamespace(args: unknown[]): void {
    if (this.namespace) {
      args.unshift(`${binary} [${this.namespace}]`);
    }
    else {
      args.unshift(binary);
    }
  }

  public debug(...args: unknown[]): void {
    if (verbose) {
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

export const logger = new Logger();
