using System.Security.Cryptography;
using System.Text;

namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// The exact six source files of the Hermes reading coach (reading-coach
// plugin, engine.py / captures.py / config.py / storage.py):
//   config.yaml         required policy config (baseline targets, timezone)
//   training-state.json required mutable state (targets, queue, open session)
//   reading-queue.yaml  required derived queue mirror
//   active-session.json optional derived mirror of the open session
//   reading-log.jsonl   optional append-only session/rating evidence
//   reading-inbox.jsonl optional append-only capture journal
//
// The reader is bounded (per-file and per-line caps), strictly UTF-8,
// rejects symlinked files and path escapes, and fingerprints every file with
// SHA-256 over its exact bytes. It never inspects the live Hermes data root.
// ---------------------------------------------------------------------------

internal sealed record ReadFileResult(string Name, byte[] Bytes, long Length, string Sha256);

internal sealed class SourceFileSet
{
    /// <summary>Canonical processing order (the order the task lists them in).</summary>
    public static readonly string[] KnownNames =
    [
        "config.yaml",
        "training-state.json",
        "reading-queue.yaml",
        "active-session.json",
        "reading-log.jsonl",
        "reading-inbox.jsonl",
    ];

    private static readonly HashSet<string> RequiredNames = new(StringComparer.Ordinal)
    {
        "config.yaml",
        "training-state.json",
        "reading-queue.yaml",
    };

    private readonly List<HermesImportIssue> _blockers = [];
    private readonly Dictionary<string, ReadFileResult> _files = new(StringComparer.Ordinal);
    private readonly HermesImportLimits _limits;

    public SourceFileSet(HermesImportLimits limits) => _limits = limits;

    public IReadOnlyList<HermesImportIssue> Blockers => _blockers;
    public IReadOnlyDictionary<string, ReadFileResult> Files => _files;

    /// <summary>Read all known files from the given directory; never writes anything.</summary>
    public void Read(string directory)
    {
        var dirFull = Path.GetFullPath(directory);
        if (!Directory.Exists(dirFull))
        {
            _blockers.Add(new HermesImportIssue(
                HermesImportCodes.DirectoryNotFound,
                "the source directory does not exist or is not a directory"));
            return;
        }
        if (new DirectoryInfo(dirFull).LinkTarget is not null)
        {
            _blockers.Add(new HermesImportIssue(
                HermesImportCodes.DirectorySymlink,
                "the source directory is a symlink; resolve it and pass the real path"));
            return;
        }
        var realDir = ResolveParentComponents(dirFull);
        var dirPrefix = realDir + Path.DirectorySeparatorChar;

        foreach (var name in KnownNames)
        {
            var full = Path.GetFullPath(Path.Combine(dirFull, name));
            var real = ResolveParentComponents(full);
            if (!real.StartsWith(dirPrefix, StringComparison.Ordinal))
            {
                _blockers.Add(new HermesImportIssue(
                    HermesImportCodes.PathEscape,
                    "the file resolves outside the source directory", name));
                continue;
            }
            var info = new FileInfo(full);
            if (info.LinkTarget is not null)
            {
                _blockers.Add(new HermesImportIssue(
                    HermesImportCodes.FileSymlink,
                    "the file is a symlink; only regular files are accepted", name));
                continue;
            }
            if (!File.Exists(full))
            {
                if (RequiredNames.Contains(name))
                {
                    _blockers.Add(new HermesImportIssue(
                        HermesImportCodes.FileMissing,
                        "required source file is missing", name));
                }
                continue;
            }
            if (info.Length > _limits.MaxFileBytes)
            {
                _blockers.Add(new HermesImportIssue(
                    HermesImportCodes.FileTooLarge,
                    $"file is {info.Length} bytes; limit is {_limits.MaxFileBytes}", name));
                continue;
            }
            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(full);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                _blockers.Add(new HermesImportIssue(
                    HermesImportCodes.UnreadableFile,
                    "the file could not be read", name));
                continue;
            }
            try
            {
                _ = StrictUtf8.GetString(bytes);
            }
            catch (DecoderFallbackException)
            {
                _blockers.Add(new HermesImportIssue(
                    HermesImportCodes.FileNotUtf8,
                    "the file is not valid UTF-8", name));
                continue;
            }
            _files[name] = new ReadFileResult(
                name,
                bytes,
                bytes.LongLength,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
        }
    }

    /// <summary>
    /// Canonical aggregate fingerprint: for each present file sorted by name
    /// (ordinal), the line "name:length:sha256"; the UTF-8 bytes of those
    /// lines are hashed with SHA-256. No timestamps, no paths, no contents.
    /// </summary>
    public string AggregateFingerprint()
    {
        var sb = new StringBuilder();
        foreach (var name in _files.Keys.OrderBy(n => n, StringComparer.Ordinal))
        {
            var file = _files[name];
            sb.Append(name).Append(':').Append(file.Length).Append(':').Append(file.Sha256).Append('\n');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()))).ToLowerInvariant();
    }

    /// <summary>Resolve symlinks in every path component above (and including) the leaf.</summary>
    private static string ResolveParentComponents(string fullPath)
    {
        var full = Path.GetFullPath(fullPath);
        var root = Path.GetPathRoot(full);
        if (string.IsNullOrEmpty(root))
        {
            return full;
        }
        var current = root;
        foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            var info = new DirectoryInfo(current);
            if (info.LinkTarget is not null)
            {
                current = info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? current;
            }
        }
        return Path.GetFullPath(current);
    }

    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);
}
