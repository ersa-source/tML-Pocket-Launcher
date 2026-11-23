using System.Reflection;
using System.Runtime.Loader;
using MobileLauncher.Bootstrap.Platform;
using MobileLauncher.Host;

var gameRoot = Environment.GetEnvironmentVariable("TML_ANDROID_GAME_ROOT")
    ?? Directory.GetCurrentDirectory();
var cacheRoot = Environment.GetEnvironmentVariable("TML_ANDROID_CACHE")
    ?? Path.Combine(gameRoot, "cache");
var assemblyPath = Environment.GetEnvironmentVariable("TML_TMODLOADER_ASSEMBLY")
    ?? throw new InvalidOperationException("No imported tModLoader package was selected.");
var contentRoot = Environment.GetEnvironmentVariable("TML_ANDROID_CONTENT")
    ?? throw new InvalidOperationException("No imported Terraria Content directory was selected.");

Directory.CreateDirectory(cacheRoot);
RuntimeLogging.Initialize(gameRoot);
Environment.SetEnvironmentVariable("TML_ANDROID_FILES", gameRoot);

// The launcher ships its own Android detour libraries, independently of the game package.
var compatibilityRoot = Path.Combine(AppContext.BaseDirectory, "MonoMod.Android");
Environment.SetEnvironmentVariable("MONOMOD_PATH", compatibilityRoot);
AssemblyLoadContext.Default.Resolving += (_, name) =>
{
    var path = Path.Combine(compatibilityRoot, name.Name + ".dll");
    return File.Exists(path) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(path) : null;
};

var isAndroid = OperatingSystem.IsAndroid() ||
    !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ANDROID_ROOT"));
IAndroidBridge bridge = isAndroid
    ? new JniAndroidBridge(gameRoot, cacheRoot)
    : new NullAndroidBridge(gameRoot, cacheRoot);

try
{
    if (!File.Exists(assemblyPath) || !Directory.Exists(Path.Combine(contentRoot, "Images")))
    {
        throw new InvalidOperationException("The imported tModLoader or Terraria package is incomplete.");
    }

    Console.WriteLine($"HOST_RUNTIME {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}; arch={System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");
    Console.WriteLine($"HOST_MEMORY managed={GC.GetTotalMemory(false)}; available={GC.GetGCMemoryInfo().TotalAvailableMemoryBytes}");
    Console.WriteLine($"HOST_CONTENT images={Directory.Exists(Path.Combine(contentRoot, "Images"))}; gameAssembly={Path.GetFileName(assemblyPath)}");
    bridge.SetStartupStatus("正在进入游戏", "正在加载 tModLoader，等待游戏画面…", -1);
    var sessionTimer = System.Diagnostics.Stopwatch.StartNew();
    try
    {
        var exitCode = new MobileLauncher.Bootstrap.GameBootstrap(bridge).LaunchManagedGame(assemblyPath, args);
        Console.WriteLine($"HOST_EXIT code={exitCode}");
        return exitCode;
    }
    finally
    {
        Console.WriteLine($"HOST_SESSION elapsedMs={sessionTimer.ElapsedMilliseconds}; managedBytes={GC.GetTotalMemory(false)}; gc0={GC.CollectionCount(0)}; gc1={GC.CollectionCount(1)}; gc2={GC.CollectionCount(2)}");
    }
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Imported tModLoader startup failed: {exception}");
    bridge.SetStartupStatus("Startup failed", exception.ToString(), 0);
    return 1;
}
