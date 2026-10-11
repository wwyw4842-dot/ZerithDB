import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthManager } from "zerithdb-auth";
import SocialRecoverySetup from "./SocialRecoverySetup";
import SocialRecoveryRestore from "./SocialRecoveryRestore";

describe("unavailable social recovery UI", () => {
  for (const recoverySupported of [false, undefined]) {
    it(`renders only an unavailable notice when support is ${recoverySupported}`, () => {
      const generateRecoveryShards = vi.fn();
      const recoverIdentity = vi.fn();
      const onRecovered = vi.fn();
      const authManager = {
        recoverySupported,
        generateRecoveryShards,
        recoverIdentity,
      } as unknown as AuthManager;
      const setup = renderToStaticMarkup(createElement(SocialRecoverySetup, { authManager }));
      const restore = renderToStaticMarkup(
        createElement(SocialRecoveryRestore, { authManager, onRecovered })
      );
      for (const markup of [setup, restore]) {
        expect(markup).toContain("Social recovery is currently unavailable");
        expect(markup).not.toMatch(/<(input|button|textarea)\b/);
        expect(markup).not.toContain("Reconstruct Master Key");
        expect(markup).not.toContain("Generate Shards");
      }
      expect(generateRecoveryShards).not.toHaveBeenCalled();
      expect(recoverIdentity).not.toHaveBeenCalled();
      expect(onRecovered).not.toHaveBeenCalled();
    });
  }
});
