# Build and runtime progress

## Current status

- [x] Forked upstream launcher to ersa-source.
- [x] Created isolated experimental/terraria-1.4.5 branch.
- [x] Read the actual Gradle configuration, development instructions, tML version catalog and package version detector.
- [x] Added source-only GitHub Actions checks for the React/TypeScript launcher.
- [ ] Confirm GitHub Actions run passes.
- [ ] Prepare reproducible Windows Android build (PowerShell, .NET 10.0.101, JDK 21, SDK 37, NDK 30 rc1, CMake 3.22.1, submodules).
- [ ] Confirm an APK artifact is produced.
- [ ] Confirm APK launches on physical Android ARM64.
- [ ] Confirm Terraria 1.4.5.8 compatibility and matching tModLoader version.
- [ ] Confirm world gameplay and small C# mod.
- [ ] Confirm Calamity.

The UI CI checks **do not build an APK** and **do not establish game compatibility**.

## Observations from inspected upstream source

- `TmlVersionCatalog` already supports multiple installed tModLoader versions and an active version.
- `PackageVersionReader` extracts tML and Terraria version information from assemblies and metadata.
- `GamePackageInstaller` stages imports with transaction recovery.
- The Android Gradle build invokes PowerShell scripts and prepares managed/native assets. An ordinary Linux Gradle APK job without adapting these steps is not sufficient.
- Upstream documentation targets Terraria 1.4.4.9 and tML 2026.09.3.1.
- Source-only UI CI can be tested independently of proprietary game resources.

## Next steps

1. Inspect the PowerShell preparation scripts and their external dependencies.
2. Establish a CI runner with the documented toolchain.
3. Build a source-only debug APK without uploading or distributing game assets.
4. Preserve logs for runtime compatibility research.
