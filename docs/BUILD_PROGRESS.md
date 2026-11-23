# Build and runtime progress

## Current status

- [x] Forked upstream launcher to ersa-source.
- [x] Created isolated experimental/terraria-1.4.5 branch.
- [x] Inspected actual Gradle configuration, development instructions, version catalog and package detector.
- [x] Added source-only GitHub Actions checks for React/TypeScript UI.
- [x] Added manually triggered Windows Android APK build workflow with .NET 10, Java 21, Node 22, Android SDK 37, pinned NDK/CMake and Git submodules.
- [ ] Confirm UI workflow passes.
- [ ] Confirm Windows APK workflow passes (the NDK pre-release identifier may need runner-specific handling).
- [ ] Confirm APK launches on physical Android ARM64.
- [ ] Confirm Terraria 1.4.5.8 compatibility and matching tModLoader version.
- [ ] Confirm world gameplay and small C# mod.
- [ ] Confirm Calamity.

**Important:** The Android build currently packages upstream's pinned tModLoader 2026.09.3.1, which targets Terraria 1.4.4.9. The workflow does not port the runtime to Terraria 1.4.5.8. A successful APK build would only prove compilation, not gameplay.

## Source inspection findings

- `TmlVersionCatalog` supports multiple installed tModLoader versions and an active selection.
- `PackageVersionReader` extracts tML and Terraria version information from assemblies and metadata.
- `GamePackageInstaller` stages imports with transaction recovery.
- Android Gradle invokes PowerShell scripts and builds managed/native assets; use Windows CI rather than a naive Linux Gradle job.
- `prepare-default-tml.ps1` downloads and SHA-256 verifies the official pinned tModLoader archive; no Terraria game content is included.
- Native source checkout requires recursive Git submodules.

## How to build

GitHub → Actions → **Experimental Android APK** → Run workflow → choose `experimental/terraria-1.4.5`.

If successful, download the `tml-pocket-experimental-arm64-debug` artifact. This is a **debug build**, not a verified release or 1.4.5.8-compatible game. Do not upload proprietary Terraria resources to GitHub.

## Next steps

1. Inspect first workflow logs and fix any build-environment failures.
2. Confirm debug APK can install and open on ARM64 Android.
3. Investigate runtime compatibility with 1.4.5.8 independently of upstream 1.4.4.9.
