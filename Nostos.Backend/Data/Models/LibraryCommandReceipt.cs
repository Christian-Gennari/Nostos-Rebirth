namespace Nostos.Backend.Data.Models;

// Exact-once command record for library mutations. The unique
// (ClientId, IdempotencyKey) index makes retried UI/MCP/connector commands
// return the stored response without re-running the command. Deliberately a
// separate table from ReadingCommandReceipt so a library command can never
// replay a reading response (and vice versa).
public class LibraryCommandReceipt
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string ClientId { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;

    public string CommandKind { get; set; } = string.Empty;
    public string ResponseJson { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
