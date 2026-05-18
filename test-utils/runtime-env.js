import { vi } from "vitest";

export function createRuntimeEnv() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }),
  };
}
