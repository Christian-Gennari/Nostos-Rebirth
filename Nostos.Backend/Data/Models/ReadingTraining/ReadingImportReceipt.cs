namespace Nostos.Backend.Data.Models.ReadingTraining;

// Record of a Hermes-data import. SourceFingerprint is unique so rerunning
// the same import is a no-op.
public class ReadingImportReceipt
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string SourceFingerprint { get; set; } = string.Empty;
    public string ResultJson { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
