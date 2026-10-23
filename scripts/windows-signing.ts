// Signs the Windows installers with a code-signing certificate, so Windows doesn't warn about an
// unknown publisher: points the bundler at the certificate's thumbprint (already imported into the
// build machine's certificate store by the release workflow) and a timestamp server, in
// src-tauri/tauri.conf.json. The release workflow runs this only when the certificate is set up.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const thumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT ?? "").trim();
if (!thumbprint) { console.error("WINDOWS_CERTIFICATE_THUMBPRINT is empty: leaving the installers unsigned."); process.exit(1); }
const path = join(import.meta.dir, "..", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(path, "utf8"));
conf.bundle.windows = {
  ...(conf.bundle.windows ?? {}),
  certificateThumbprint: thumbprint,
  digestAlgorithm: "sha256",
  timestampUrl: process.env.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com",
};
writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
console.log(`Windows signing on: certificate ${thumbprint.slice(0, 8)}…`);
