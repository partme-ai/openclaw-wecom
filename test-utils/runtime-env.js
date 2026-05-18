import { vi } from "vitest";

export function createRuntimeEnv() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code) => {
      throw new Error(`exit ${code}`);
    }),
  };
}
