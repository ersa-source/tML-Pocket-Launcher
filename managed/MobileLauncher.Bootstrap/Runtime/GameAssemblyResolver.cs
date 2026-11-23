using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Reflection;
using System.Runtime.Loader;

namespace MobileLauncher.Bootstrap.Runtime;

/// <summary>Resolves game dependencies while keeping launcher detours isolated from release copies.</summary>
public sealed class GameAssemblyResolver : IDisposable
{
    private readonly string _assemblyDirectory;
    private readonly string? _compatibilityDirectory;
    private readonly Lazy<IReadOnlyDictionary<string, string[]>> _assemblyIndex;

    public GameAssemblyResolver(string assemblyDirectory, string? compatibilityDirectory = null)
    {
        _assemblyDirectory = Path.GetFullPath(assemblyDirectory);
        _compatibilityDirectory = compatibilityDirectory;
        _assemblyIndex = new Lazy<IReadOnlyDictionary<string, string[]>>(
            () => BuildAssemblyIndex(Path.Combine(_assemblyDirectory, "Libraries")),
            LazyThreadSafetyMode.ExecutionAndPublication);
        AssemblyLoadContext.Default.Resolving += OnResolving;
        AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;
    }

    internal string? FindAssemblyPath(AssemblyName requestedAssembly)
    {
        var searchDirectories = new List<string>();
        if (!string.IsNullOrWhiteSpace(_compatibilityDirectory))
        {
            searchDirectories.Add(_compatibilityDirectory);
        }

        searchDirectories.Add(_assemblyDirectory);
        var assemblyFile = requestedAssembly.Name + ".dll";
        var candidates = new List<string>();
        foreach (var directory in searchDirectories)
        {
            var candidate = Path.Combine(directory, assemblyFile);
            if (File.Exists(candidate))
            {
                candidates.Add(candidate);
            }
        }

        // Direct exact matches already outrank every indexed candidate.
        // Avoid scanning and probing the entire Libraries tree until needed.
        var directMatch = candidates.FirstOrDefault(candidate =>
            MatchesAssembly(candidate, requestedAssembly, requireExactVersion: true));
        if (directMatch is not null)
        {
            return directMatch;
        }

        if (_assemblyIndex.Value.TryGetValue(assemblyFile, out var indexedCandidates))
        {
            candidates.AddRange(indexedCandidates);
        }

        candidates = candidates.Distinct(StringComparer.Ordinal).ToList();
        var resolvedPath = candidates.FirstOrDefault(candidate =>
            MatchesAssembly(candidate, requestedAssembly, requireExactVersion: true));
        resolvedPath ??= candidates.FirstOrDefault(candidate =>
            MatchesAssembly(candidate, requestedAssembly, requireExactVersion: false));
        if (resolvedPath is null)
        {
            Console.WriteLine($"[MobileLauncher.Bootstrap] Unresolved dependency: {requestedAssembly.FullName}; candidates={candidates.Count}");
            return null;
        }

        return resolvedPath;
    }

    private Assembly? OnResolving(AssemblyLoadContext context, AssemblyName requestedAssembly)
    {
        var path = FindAssemblyPath(requestedAssembly);
        if (path is null)
        {
            return null;
        }

        Console.WriteLine($"[MobileLauncher.Bootstrap] Resolved {requestedAssembly.FullName} from {path}");
        return context.LoadFromAssemblyPath(path);
    }

    private Assembly? OnAssemblyResolve(object? sender, ResolveEventArgs args) =>
        OnResolving(AssemblyLoadContext.Default, new AssemblyName(args.Name));

    public void Dispose()
    {
        AssemblyLoadContext.Default.Resolving -= OnResolving;
        AppDomain.CurrentDomain.AssemblyResolve -= OnAssemblyResolve;
    }

    private static IReadOnlyDictionary<string, string[]> BuildAssemblyIndex(string libraryDirectory)
    {
        if (!Directory.Exists(libraryDirectory))
        {
            return new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        }

        return Directory.EnumerateFiles(libraryDirectory, "*.dll", SearchOption.AllDirectories)
            .Where(path => !IsReferenceAssembly(path))
            .Select(path => (Name: Path.GetFileName(path)!, Path: path))
            .GroupBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group
                    .Select(file => file.Path)
                    .OrderBy(GetAssemblyCandidatePriority)
                    .ThenBy(path => path, StringComparer.Ordinal)
                    .ToArray(),
                StringComparer.OrdinalIgnoreCase);
    }

    private static int GetAssemblyCandidatePriority(string path)
    {
        if (IsAndroidRuntime() &&
            path.Contains(
                $"{Path.DirectorySeparatorChar}runtimes{Path.DirectorySeparatorChar}linux{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
        {
            return 0;
        }

        if (path.Contains(
                $"{Path.DirectorySeparatorChar}runtimes{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
        {
            return 1;
        }

        return 2;
    }

    private static bool IsAndroidRuntime()
    {
        return OperatingSystem.IsAndroid() ||
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ANDROID_ROOT"));
    }

    private static bool IsReferenceAssembly(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var pe = new PEReader(stream);
            if (!pe.HasMetadata) return true;
            var metadata = pe.GetMetadataReader();
            if (!metadata.IsAssembly) return true;
            foreach (var handle in metadata.GetAssemblyDefinition().GetCustomAttributes())
            {
                var attribute = metadata.GetCustomAttribute(handle);
                if (attribute.Constructor.Kind != HandleKind.MemberReference) continue;
                var member = metadata.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
                if (member.Parent.Kind != HandleKind.TypeReference) continue;
                var type = metadata.GetTypeReference((TypeReferenceHandle)member.Parent);
                if (metadata.GetString(type.Name) == "ReferenceAssemblyAttribute" &&
                    metadata.GetString(type.Namespace) == "System.Runtime.CompilerServices")
                    return true;
            }
            return false;
        }
        catch (Exception exception) when (exception is IOException or BadImageFormatException)
        {
            return true;
        }
    }

    private static bool MatchesAssembly(
        string path,
        AssemblyName requestedAssembly,
        bool requireExactVersion)
    {
        try
        {
            var candidate = AssemblyName.GetAssemblyName(path);
            if (!string.Equals(candidate.Name, requestedAssembly.Name, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (requireExactVersion && requestedAssembly.Version is not null &&
                requestedAssembly.Version != new Version(0, 0, 0, 0) &&
                candidate.Version != requestedAssembly.Version)
            {
                return false;
            }

            var requestedToken = requestedAssembly.GetPublicKeyToken();
            var candidateToken = candidate.GetPublicKeyToken();
            return requestedToken is null || requestedToken.Length == 0 ||
                candidateToken is not null && requestedToken.SequenceEqual(candidateToken);
        }
        catch (Exception exception) when (exception is IOException or BadImageFormatException)
        {
            return false;
        }
    }
}
