// Synthetic-only fixture; served by the isolated Vite test server, not a Next route.
import { createRoot } from "react-dom/client";
import { AuthManager } from "../../../packages/auth/src/auth-manager";
import SocialRecoverySetup from "../src/components/SocialRecoverySetup";
import SocialRecoveryRestore from "../src/components/SocialRecoveryRestore";

async function run() {
  const storageKey = "__zd06_synthetic_browser_gate";
  const auth = new AuthManager({ appId: "zd06-synthetic-gate", auth: { storageKey } });
  const identity = await auth.signIn();
  const bytesBefore = localStorage.getItem(storageKey);
  const input = new TextEncoder().encode("synthetic browser recovery gate");
  const signature = await auth.sign(input);
  let changes = 0;
  let recoveredCallback = 0;
  auth.on("identity:change", () => changes++);
  createRoot(document.getElementById("root")!).render(
    <>
      <SocialRecoverySetup authManager={auth} />
      <SocialRecoveryRestore authManager={auth} onRecovered={() => recoveredCallback++} />
    </>
  );
  const rejected: boolean[] = [];
  for (const call of [
    () => auth.generateRecoveryShards(2, 3),
    () => auth.recoverIdentity(["AfQ=", "AgY="]),
  ]) {
    try {
      await call();
      rejected.push(false);
    } catch (error) {
      rejected.push(error instanceof Error && error.message.includes("not available"));
    }
  }
  // Only booleans are exposed to the harness, never keys, shares or storage contents.
  Object.assign(window, {
    zd06Result: {
      rejected,
      sameIdentity: auth.identity === identity,
      sameStorage: bytesBefore === localStorage.getItem(storageKey),
      sameSignature: signature === (await auth.sign(input)),
      signatureVerifies: await auth.verify(input, signature, identity.publicKey),
      changes,
      recoveredCallback,
    },
  });
}
run().catch((error) => {
  Object.assign(window, { zd06Failure: error instanceof Error ? error.message : "fixture failed" });
});
