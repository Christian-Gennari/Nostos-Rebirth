using System.Globalization;
using System.Text.Json;
using System.Text;

namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Strict JSON: parses UTF-8 bytes into a small node model, rejecting
// duplicate object properties, comments, trailing commas, and any content
// after the root value. Deterministic; reports one error at a time with a
// 1-based line number computed from the byte offset.
// ---------------------------------------------------------------------------

internal enum JsonNodeKind
{
    Null,
    Bool,
    Number,
    String,
    Object,
    Array,
}

internal sealed class JsonNode
{
    public required JsonNodeKind Kind { get; init; }
    public bool BoolValue { get; init; }
    public string? StringValue { get; init; }
    public string? NumberRaw { get; init; }

    // Objects preserve source property order.
    public IReadOnlyList<KeyValuePair<string, JsonNode>> Properties { get; init; } =
        Array.Empty<KeyValuePair<string, JsonNode>>();
    public IReadOnlyList<JsonNode> Items { get; init; } = Array.Empty<JsonNode>();

    public bool IsObject => Kind == JsonNodeKind.Object;
    public bool IsArray => Kind == JsonNodeKind.Array;

    public JsonNode? Get(string property)
    {
        foreach (var (key, value) in Properties)
        {
            if (string.Equals(key, property, StringComparison.Ordinal))
            {
                return value;
            }
        }
        return null;
    }

    public bool TryGetString(string property, out string? value)
    {
        var node = Get(property);
        if (node is { Kind: JsonNodeKind.String })
        {
            value = node.StringValue;
            return true;
        }
        value = null;
        return false;
    }

    public bool TryGetInt(string property, out int value)
    {
        var node = Get(property);
        if (node is { Kind: JsonNodeKind.Number } &&
            int.TryParse(node.NumberRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }
        value = 0;
        return false;
    }

    public bool TryGetBool(string property, out bool value)
    {
        var node = Get(property);
        if (node is { Kind: JsonNodeKind.Bool })
        {
            value = node.BoolValue;
            return true;
        }
        value = false;
        return false;
    }

    public bool TryGetStringOrNull(string property, out string? value)
    {
        var node = Get(property);
        if (node is { Kind: JsonNodeKind.Null })
        {
            value = null;
            return true;
        }
        return TryGetString(property, out value);
    }
}

internal static class StrictJson
{
    public sealed record ParseResult(JsonNode? Root, string? Error, long? ErrorLine);

    public static ParseResult Parse(ReadOnlySpan<byte> utf8)
    {
        // Accept an optional UTF-8 BOM without changing the exact-byte file
        // fingerprint. Python writes the source files without one, but a
        // hand-copied cutover fixture may legitimately contain it.
        if (utf8.StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }))
        {
            utf8 = utf8[3..];
        }
        try
        {
            var reader = new Utf8JsonReader(
                utf8,
                new JsonReaderOptions { CommentHandling = JsonCommentHandling.Disallow });
            var root = ReadNode(ref reader, utf8, out var error);
            if (error is not null)
            {
                return new ParseResult(null, error, LineAt(utf8, reader.TokenStartIndex));
            }
            // Anything beyond the root value (even a second complete token) is garbage.
            try
            {
                if (reader.Read())
                {
                    return new ParseResult(null, "trailing content after the JSON document", LineAt(utf8, reader.TokenStartIndex));
                }
            }
            catch (JsonException)
            {
                return new ParseResult(null, "trailing garbage after the JSON document", LineAt(utf8, reader.TokenStartIndex));
            }
            return new ParseResult(root, null, null);
        }
        catch (JsonException ex)
        {
            // Utf8JsonReader tracks 1-based LineNumber and BytePositionInLine.
            return new ParseResult(null, ex.Message, ex.LineNumber + 1);
        }
    }

    /// <summary>Reads one node; the reader is positioned before its first token.</summary>
    private static JsonNode? ReadNode(ref Utf8JsonReader reader, ReadOnlySpan<byte> utf8, out string? error)
    {
        error = null;
        if (!reader.Read())
        {
            error = "empty JSON document";
            return null;
        }
        return ReadNodeCore(ref reader, utf8, out error);
    }

    private static JsonNode? ReadNodeCore(ref Utf8JsonReader reader, ReadOnlySpan<byte> utf8, out string? error)
    {
        error = null;
        switch (reader.TokenType)
        {
            case JsonTokenType.StartObject:
            {
                var properties = new List<KeyValuePair<string, JsonNode>>();
                var names = new HashSet<string>(StringComparer.Ordinal);
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndObject)
                    {
                        return new JsonNode { Kind = JsonNodeKind.Object, Properties = properties };
                    }
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        error = "expected a property name";
                        return null;
                    }
                    var name = reader.GetString()!;
                    if (!names.Add(name))
                    {
                        error = $"duplicate property '{name}'";
                        return null;
                    }
                    // Advance from the property name to its value token.
                    if (!reader.Read())
                    {
                        error = "unterminated object";
                        return null;
                    }
                    var value = ReadNodeCore(ref reader, utf8, out error);
                    if (value is null)
                    {
                        return null;
                    }
                    properties.Add(new KeyValuePair<string, JsonNode>(name, value));
                }
                error = "unterminated object";
                return null;
            }
            case JsonTokenType.StartArray:
            {
                var items = new List<JsonNode>();
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndArray)
                    {
                        return new JsonNode { Kind = JsonNodeKind.Array, Items = items };
                    }
                    var value = ReadNodeCore(ref reader, utf8, out error);
                    if (value is null)
                    {
                        return null;
                    }
                    items.Add(value);
                }
                error = "unterminated array";
                return null;
            }
            case JsonTokenType.String:
                return new JsonNode { Kind = JsonNodeKind.String, StringValue = reader.GetString() };
            case JsonTokenType.Number:
            {
                var start = checked((int)reader.TokenStartIndex);
                var length = checked((int)(reader.BytesConsumed - reader.TokenStartIndex));
                return new JsonNode
                {
                    Kind = JsonNodeKind.Number,
                    NumberRaw = Encoding.UTF8.GetString(utf8.Slice(start, length)),
                };
            }
            case JsonTokenType.True:
                return new JsonNode { Kind = JsonNodeKind.Bool, BoolValue = true };
            case JsonTokenType.False:
                return new JsonNode { Kind = JsonNodeKind.Bool, BoolValue = false };
            case JsonTokenType.Null:
                return new JsonNode { Kind = JsonNodeKind.Null };
            default:
                error = $"unexpected token '{reader.TokenType}'";
                return null;
        }
    }

    private static long LineAt(ReadOnlySpan<byte> utf8, long byteOffset)
    {
        var end = (int)Math.Min(byteOffset, utf8.Length);
        var line = 1L;
        for (var i = 0; i < end; i++)
        {
            if (utf8[i] == (byte)'\n')
            {
                line++;
            }
        }
        return line;
    }
}
