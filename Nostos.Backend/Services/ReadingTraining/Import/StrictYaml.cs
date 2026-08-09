using System.Globalization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Strict YAML: parses the fixed engine schema via YamlDotNet's low-level
// event parser only (no Deserializer, so no type-tag instantiation is ever
// possible). Rejects duplicate mapping keys, non-scalar mapping keys,
// anchors/aliases, multiple documents, and any explicit tag outside the YAML
// core schema.
// ---------------------------------------------------------------------------

internal enum YamlNodeKind
{
    Null,
    Scalar,
    Mapping,
    Sequence,
}

internal sealed class YamlNode
{
    public required YamlNodeKind Kind { get; init; }
    public string? ScalarValue { get; init; }
    public IReadOnlyList<KeyValuePair<string, YamlNode>> Mapping { get; init; } =
        Array.Empty<KeyValuePair<string, YamlNode>>();
    public IReadOnlyList<YamlNode> Sequence { get; init; } = Array.Empty<YamlNode>();

    public bool IsMapping => Kind == YamlNodeKind.Mapping;
    public bool IsSequence => Kind == YamlNodeKind.Sequence;

    public YamlNode? Get(string key)
    {
        foreach (var (k, v) in Mapping)
        {
            if (string.Equals(k, key, StringComparison.Ordinal))
            {
                return v;
            }
        }
        return null;
    }

    public bool TryGetString(string key, out string? value)
    {
        var node = Get(key);
        if (node is { Kind: YamlNodeKind.Scalar })
        {
            value = node.ScalarValue;
            return true;
        }
        value = null;
        return false;
    }

    public bool TryGetInt(string key, out int value)
    {
        var node = Get(key);
        if (node is { Kind: YamlNodeKind.Scalar } &&
            int.TryParse(node.ScalarValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }
        value = 0;
        return false;
    }

    public bool TryGetBool(string key, out bool value)
    {
        var node = Get(key);
        if (node is { Kind: YamlNodeKind.Scalar } && IsYamlBool(node.ScalarValue, out value))
        {
            return true;
        }
        value = false;
        return false;
    }

    public bool TryGetStringOrNull(string key, out string? value)
    {
        var node = Get(key);
        if (node is { Kind: YamlNodeKind.Null })
        {
            value = null;
            return true;
        }
        return TryGetString(key, out value);
    }

    /// <summary>YAML core-schema bool: the engine's safe_dump emits true/false.</summary>
    public static bool IsYamlBool(string? text, out bool value)
    {
        if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase))
        {
            value = true;
            return true;
        }
        if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase))
        {
            value = false;
            return true;
        }
        value = false;
        return false;
    }

    public static bool IsYamlNull(string? text) =>
        text is null ||
        string.Equals(text, "null", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(text, "~", StringComparison.Ordinal) ||
        text.Length == 0;
}

internal static class StrictYaml
{
    public sealed record ParseResult(YamlNode? Root, string? Error, long? ErrorLine);

    // YAML core schema tags are the only explicit tags ever accepted; the
    // engine's safe_dump never emits explicit tags at all.
    private static readonly HashSet<string> CoreTags = new(StringComparer.Ordinal)
    {
        "tag:yaml.org,2002:str",
        "tag:yaml.org,2002:int",
        "tag:yaml.org,2002:float",
        "tag:yaml.org,2002:bool",
        "tag:yaml.org,2002:null",
        "tag:yaml.org,2002:seq",
        "tag:yaml.org,2002:map",
    };

    public static ParseResult Parse(string text)
    {
        var parser = new Parser(new StringReader(text));
        var stack = new Stack<object>();
        YamlNode? root = null;
        try
        {
            while (parser.MoveNext())
            {
                switch (parser.Current)
                {
                    case Scalar scalar:
                    {
                        if (!scalar.Anchor.IsEmpty)
                        {
                            return Error("anchors are not supported", scalar.Start.Line);
                        }
                        if (!TagAllowed(scalar.Tag))
                        {
                            return Error($"unsafe YAML tag '{scalar.Tag.Value}'", scalar.Start.Line);
                        }
                        var node = scalar.Style == ScalarStyle.Plain && YamlNode.IsYamlNull(scalar.Value)
                            ? new YamlNode { Kind = YamlNodeKind.Null }
                            : new YamlNode { Kind = YamlNodeKind.Scalar, ScalarValue = scalar.Value };
                        if (stack.Count == 0)
                        {
                            if (root is not null)
                            {
                                return Error("multiple YAML documents", scalar.Start.Line);
                            }
                            root = node;
                            break;
                        }
                        switch (stack.Peek())
                        {
                            case MappingFrame map:
                                if (map.PendingKey is null)
                                {
                                    if (!map.Keys.Add(scalar.Value))
                                    {
                                        return Error($"duplicate key '{scalar.Value}'", scalar.Start.Line);
                                    }
                                    map.PendingKey = scalar.Value;
                                }
                                else
                                {
                                    map.Entries.Add(new KeyValuePair<string, YamlNode>(map.PendingKey, node));
                                    map.PendingKey = null;
                                }
                                break;
                            case SequenceFrame seq:
                                seq.Items.Add(node);
                                break;
                        }
                        break;
                    }
                    case MappingStart mappingStart:
                    {
                        if (!mappingStart.Anchor.IsEmpty)
                        {
                            return Error("anchors are not supported", mappingStart.Start.Line);
                        }
                        if (stack.Count > 0 && stack.Peek() is MappingFrame { PendingKey: null })
                        {
                            return Error("mapping used as a mapping key", mappingStart.Start.Line);
                        }
                        stack.Push(new MappingFrame());
                        break;
                    }
                    case MappingEnd mappingEnd:
                        root = PopFrame(stack, root, mappingEnd.End.Line, out var mapError);
                        if (mapError is not null)
                        {
                            return Error(mapError, mappingEnd.End.Line);
                        }
                        break;
                    case SequenceStart sequenceStart:
                    {
                        if (!sequenceStart.Anchor.IsEmpty)
                        {
                            return Error("anchors are not supported", sequenceStart.Start.Line);
                        }
                        if (stack.Count > 0 && stack.Peek() is MappingFrame { PendingKey: null })
                        {
                            return Error("sequence used as a mapping key", sequenceStart.Start.Line);
                        }
                        stack.Push(new SequenceFrame());
                        break;
                    }
                    case SequenceEnd sequenceEnd:
                        root = PopFrame(stack, root, sequenceEnd.End.Line, out var seqError);
                        if (seqError is not null)
                        {
                            return Error(seqError, sequenceEnd.End.Line);
                        }
                        break;
                    case AnchorAlias alias:
                        return Error("aliases are not supported", alias.Start.Line);
                    case DocumentStart:
                    case DocumentEnd:
                    case StreamStart:
                    case StreamEnd:
                    case Comment:
                        break;
                    default:
                        return Error("unsupported YAML construct", parser.Current!.Start.Line);
                }
            }
        }
        catch (YamlException ex)
        {
            return new ParseResult(null, ex.Message, ex.Start.Line);
        }
        return root is null
            ? new ParseResult(null, "empty YAML document", null)
            : new ParseResult(root, null, null);
    }

    private sealed class MappingFrame
    {
        public List<KeyValuePair<string, YamlNode>> Entries { get; } = [];
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);
        public string? PendingKey { get; set; }
    }

    private sealed class SequenceFrame
    {
        public List<YamlNode> Items { get; } = [];
    }

    private static YamlNode? PopFrame(Stack<object> stack, YamlNode? root, long line, out string? error)
    {
        error = null;
        if (stack.Count == 0)
        {
            error = "unbalanced YAML structure";
            return null;
        }
        var frame = stack.Pop();
        YamlNode node = frame switch
        {
            MappingFrame map => new YamlNode { Kind = YamlNodeKind.Mapping, Mapping = map.Entries },
            SequenceFrame seq => new YamlNode { Kind = YamlNodeKind.Sequence, Sequence = seq.Items },
            _ => throw new InvalidOperationException("unknown YAML frame"),
        };
        if (stack.Count == 0)
        {
            if (root is not null)
            {
                error = "multiple YAML documents";
                return null;
            }
            return node;
        }
        switch (stack.Peek())
        {
            case MappingFrame map:
                if (map.PendingKey is null)
                {
                    error = "unexpected nested structure without a mapping key";
                    return null;
                }
                map.Entries.Add(new KeyValuePair<string, YamlNode>(map.PendingKey, node));
                map.PendingKey = null;
                break;
            case SequenceFrame seq:
                seq.Items.Add(node);
                break;
        }
        return null; // not a root yet
    }

    private static bool TagAllowed(TagName tag) =>
        tag.IsEmpty || tag.IsNonSpecific || CoreTags.Contains(tag.Value);

    private static ParseResult Error(string message, long line) =>
        new(null, message, line);
}
