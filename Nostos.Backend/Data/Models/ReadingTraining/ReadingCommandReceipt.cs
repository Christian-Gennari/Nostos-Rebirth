namespace Nostos.Backend.Data.Models.ReadingTraining;

// Exact-once command record. The unique (ClientId, IdempotencyKey) index makes
// retried UI/MCP/Telegram commands return the stored response without
// re-running the command.
public class ReadingCommandReceipt
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string ClientId { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;

    public string CommandKind { get; set; } = string.Empty;
    public string ResponseJson { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
