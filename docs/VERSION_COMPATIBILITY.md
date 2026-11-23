# Version compatibility — experimental branch

This branch is an **investigation**, not a working Terraria 1.4.5 port. Main remains the upstream-compatible baseline.

## Verified from upstream repository documentation

| Component | Baseline | Experimental target |
| --- | --- | --- |
| Terraria PC resources | 1.4.4.9 | 1.4.5.8 (not yet supported here) |
| tModLoader | 2026.09.3.1 | Matching 1.4.5 tML release **must be verified** |
| Android runtime | CoreCLR, FNA/SDL | Evaluate changes; no runtime swap yet |
| Game startup | Main menu reported on physical Android device | Untested |
| Large mods | Calamity/Thorium not verified | Untested |

The MantovaniDevTrue/TmodLoader-Android project is a separate experimental port. Its newer game version and Mono JIT approach are **not** interchangeable with Pocket Launcher's CoreCLR-based game host.

## Safe compatibility policy

1. Detect Terraria resource version from package metadata or assembly.
2. Detect tModLoader release version separately.
3. Maintain an explicit compatibility manifest with independently validated game/tML combinations.
4. Block mismatched combinations **only after** a reliable compatibility matrix is established; warn on unknown versions.
5. Never patch the 1.4.4 baseline just to make a 1.4.5 package appear valid.
6. Run tiny C# mod tests before attempting Calamity or Thorium.
7. Keep mod packs, saves, configs and runtime logs backed up before testing.

## Existing code worth retaining

- `PackageVersionReader.kt` detects version metadata.
- `TmlVersionCatalog.kt` already supports multiple installed tML versions and selection.
- `GamePackageInstaller.kt` performs staged imports and rollback.
- Existing launch/crash reports provide diagnostic starting points.

## Research tasks

- [ ] Confirm exact tModLoader release targeting Terraria 1.4.5.8.
- [ ] Compare FNA/SDL and runtime versions across both ports.
- [ ] Inspect mod loading and MonoMod compatibility differences.
- [ ] Determine native dependencies and licensing before porting code.
- [ ] Produce Android APK build artifact without proprietary Terraria files.
- [ ] Test actual launch on an ARM64 Android device with legally obtained game resources.
- [ ] Test world creation, saving, loading and one small C# mod.
- [ ] Measure crashes, memory, FPS and GPU compatibility.
- [ ] Test Calamity only after the above passes.

## Legal note

Pocket Launcher documentation describes Steam/GOG resource import and an optional conversion-enabled build using an installed Terraria PE copy. That is distinct from owning PC Terraria; do not assume the standard APK includes the converter. Never commit or distribute proprietary game resources or bypass entitlement checks.
