# Android tModLoader launcher: development research

This repository is a fork of FireworkSky/tML-Pocket-Launcher. Preserve upstream attribution, individual component licenses, and submodule histories.

## Goal
Build an Android ARM64 launcher capable of loading legitimately obtained Terraria PC assets, tModLoader releases and compatible .tmod mods. Calamity and Thorium are long-term **unverified** targets.

## Existing foundation (Pocket Launcher)
- Android Kotlin/Java app and JNI/native host: android/
- Managed C# runtime, Steam/GOG resource integration, compatibility: managed/
- React/TypeScript launcher interface: ui/launcher/
- Native dependencies and patches: external/
- Build and checks: scripts/
- Local .tmod metadata, mod enable/disable, dependency checks, mod packs
- Touch input via MobileJoystick

## Comparison: MantovaniDevTrue/TmodLoader-Android
- Native Android ARM64 .NET 10 / Mono JIT + SDL3/FNA/OpenGL
- Reports entering/saving a world with a small C# mod on a physical phone
- Includes diagnostics and mobile touch adaptation
- Its documented build targets Terraria PC 1.4.5.8, while Pocket Launcher documents Terraria 1.4.4.9 / tML 2026.09.3.1. **Do not mix binaries or patches across these versions.**
- Treat its design as reference. Before porting any source code, inspect exact file/component licenses and compatibility.

## Ordered milestones
1. Establish reproducible source-only CI for existing launcher (no proprietary game binaries).
2. Inspect upstream Android build, runtime boundaries, native dependencies and licenses.
3. Add opt-in sanitized launch diagnostics and device compatibility reporting.
4. Validate owned-game import and game menu on a physical Android ARM64 device.
5. Validate entering/saving a world with one tiny C# mod.
6. Investigate heavy-mod memory, shader and runtime failures with measured traces.
7. Test Calamity and Thorium individually; never advertise support without actual test results.

## Security and distribution
- No proprietary Terraria files, login tokens, private assets or signing keys in git or CI artifacts.
- Do not bypass Steam/GOG ownership verification.
- Keep upstream acknowledgments and third-party license notices.
- Avoid copying code from the other port until license and technical review.
- Android APK builds and runtime verification are distinct; green CI is not proof of gameplay.
