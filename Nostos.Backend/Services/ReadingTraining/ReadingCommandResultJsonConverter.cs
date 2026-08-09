using System.Text.Json;
using System.Text.Json.Serialization;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.ReadingTraining;

// Round-trips a ReadingCommandResultDto (including its polymorphic Data
// payload) through the ReadingCommandReceipt.ResponseJson column. The Data
// runtime type is stored alongside the payload so a duplicate retry can
// deserialize the exact stored original result without re-running the
// command. The wire format is internal to the receipt column; the envelope
// itself is unchanged.
internal sealed class ReadingCommandResultJsonConverter : JsonConverter<ReadingCommandResultDto>
{
    public override ReadingCommandResultDto Read(
        ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var root = document.RootElement;

        var reply = root.TryGetProperty("reply", out var replyElement)
            ? replyElement.GetString() ?? string.Empty
            : string.Empty;
        var stateVersion = root.TryGetProperty("stateVersion", out var versionElement)
            ? versionElement.GetString() ?? string.Empty
            : string.Empty;
        var duplicate = root.TryGetProperty("duplicate", out var duplicateElement)
            && duplicateElement.GetBoolean();

        object? data = null;
        if (root.TryGetProperty("dataType", out var dataTypeElement)
            && dataTypeElement.ValueKind == JsonValueKind.String
            && Type.GetType(dataTypeElement.GetString()!) is { } dataType
            && root.TryGetProperty("data", out var dataElement)
            && dataElement.ValueKind != JsonValueKind.Null)
        {
            data = dataElement.Deserialize(dataType, options);
        }

        return new ReadingCommandResultDto(reply, data, stateVersion, duplicate);
    }

    public override void Write(Utf8JsonWriter writer, ReadingCommandResultDto value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteString("reply", value.Reply);
        writer.WriteString("stateVersion", value.StateVersion);
        writer.WriteBoolean("duplicate", value.Duplicate);
        if (value.Data is not null)
        {
            writer.WriteString("dataType", value.Data.GetType().AssemblyQualifiedName);
            writer.WritePropertyName("data");
            JsonSerializer.Serialize(writer, value.Data, value.Data.GetType(), options);
        }
        else
        {
            writer.WriteNull("data");
        }
        writer.WriteEndObject();
    }
}
