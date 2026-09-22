using System.Text;
using System.Text.Json;
using Nostos.Backend.Services.Ai;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// Detects the narrow runaway pattern that is always redundant for today's
/// in-process Nostos tools: the model asks for the same ordered tool batch with
/// JSON-equivalent arguments on two consecutive completion rounds.
///
/// Tool-call ids are intentionally ignored. Object property order and
/// whitespace are normalized, while array order is preserved because it can be
/// semantically meaningful.
/// </summary>
public sealed class AssistantToolLoopDetector
{
    private string? _previousBatchFingerprint;

    public bool IsImmediateRepeat(IReadOnlyList<LlmToolCall> calls)
    {
        ArgumentNullException.ThrowIfNull(calls);

        if (calls.Count == 0)
        {
            _previousBatchFingerprint = null;
            return false;
        }

        var current = Fingerprint(calls);
        var repeated = string.Equals(
            current,
            _previousBatchFingerprint,
            StringComparison.Ordinal);

        _previousBatchFingerprint = current;
        return repeated;
    }

    public static string Fingerprint(IReadOnlyList<LlmToolCall> calls)
    {
        ArgumentNullException.ThrowIfNull(calls);

        var builder = new StringBuilder();
        foreach (var call in calls)
        {
            builder.Append(call.Name);
            builder.Append('\n');
            builder.Append(CanonicalizeArguments(call.ArgumentsJson));
            builder.Append("\n--\n");
        }

        return builder.ToString();
    }

    private static string CanonicalizeArguments(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return "{}";
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                WriteCanonical(writer, document.RootElement);
            }

            return Encoding.UTF8.GetString(stream.ToArray());
        }
        catch (JsonException)
        {
            return json.Trim();
        }
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject()
                             .OrderBy(item => item.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;

            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray())
                {
                    WriteCanonical(writer, item);
                }
                writer.WriteEndArray();
                break;

            case JsonValueKind.String:
                writer.WriteStringValue(element.GetString());
                break;

            case JsonValueKind.Number:
                writer.WriteRawValue(element.GetRawText());
                break;

            case JsonValueKind.True:
                writer.WriteBooleanValue(true);
                break;

            case JsonValueKind.False:
                writer.WriteBooleanValue(false);
                break;

            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                writer.WriteNullValue();
                break;

            default:
                writer.WriteRawValue(element.GetRawText());
                break;
        }
    }
}
