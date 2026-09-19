declare module "potrace" {
  export interface PotraceInstance {
    setParameters(params: Record<string, unknown>): void;
    loadImage(input: Buffer | string, cb: (err: Error | null) => void): void;
    getPathTag(): string;
    getSVG(): string;
  }

  export class Potrace {
    constructor();
    setParameters(params: Record<string, unknown>): void;
    loadImage(input: Buffer | string, cb: (err: Error | null) => void): void;
    getPathTag(): string;
    getSVG(): string;
  }

  export function trace(
    input: Buffer | string,
    params: Record<string, unknown>,
    cb: (err: Error | null, svg: string) => void,
  ): void;

  export function posterize(
    input: Buffer | string,
    params: Record<string, unknown>,
    cb: (err: Error | null, svg: string) => void,
  ): void;

  export default {
    Potrace,
    trace,
    posterize,
  };
}
