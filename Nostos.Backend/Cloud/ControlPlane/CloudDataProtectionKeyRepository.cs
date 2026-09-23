using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Npgsql;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud.ControlPlane;

/// <summary>
/// Shared Cloud Data Protection key ring. The XML keys live in the control
/// plane, encrypted with a separate operator-injected 256-bit wrapping key.
/// </summary>
public sealed class CloudDataProtectionKeyRepository(
    CloudDatabaseConnections connections,
    CloudDataProtectionKeyMaterial material) : IXmlRepository
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        using var connection = new NpgsqlConnection(connections.ControlPlane);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT "EncryptedXml"
            FROM "DataProtectionKeys"
            ORDER BY "CreatedAtUtc", "FriendlyName";
            """;

        using var reader = command.ExecuteReader();
        var elements = new List<XElement>();
        while (reader.Read())
        {
            var xml = Decrypt(reader.GetString(0));
            elements.Add(XElement.Parse(xml, LoadOptions.PreserveWhitespace));
        }

        return elements;
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        ArgumentNullException.ThrowIfNull(element);
        ArgumentException.ThrowIfNullOrWhiteSpace(friendlyName);

        if (friendlyName.Length > 200)
            throw new ArgumentOutOfRangeException(nameof(friendlyName));

        var encrypted = Encrypt(element.ToString(SaveOptions.DisableFormatting));

        using var connection = new NpgsqlConnection(connections.ControlPlane);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO "DataProtectionKeys" ("FriendlyName", "EncryptedXml", "CreatedAtUtc")
            VALUES (@name, @xml, @created)
            ON CONFLICT ("FriendlyName") DO UPDATE
            SET "EncryptedXml" = EXCLUDED."EncryptedXml";
            """;
        command.Parameters.AddWithValue("name", friendlyName);
        command.Parameters.AddWithValue("xml", encrypted);
        command.Parameters.AddWithValue("created", DateTime.UtcNow);
        command.ExecuteNonQuery();
    }

    public void EnsureReadable()
    {
        try
        {
            _ = GetAllElements();
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                "Nostos Cloud could not read its persistent Data Protection key ring. Verify the control-plane database and Data Protection key-encryption secret.",
                exception);
        }
    }

    private string Encrypt(string value)
    {
        var plaintext = Encoding.UTF8.GetBytes(value);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(material.Key, TagSize);
        aes.Encrypt(nonce, plaintext, ciphertext, tag);

        return string.Join(
            '.',
            "v1",
            Convert.ToBase64String(nonce),
            Convert.ToBase64String(tag),
            Convert.ToBase64String(ciphertext));
    }

    private string Decrypt(string value)
    {
        var parts = value.Split('.');
        if (parts.Length != 4 || parts[0] != "v1")
            throw new CryptographicException("Unsupported Data Protection key envelope.");

        try
        {
            var nonce = Convert.FromBase64String(parts[1]);
            var tag = Convert.FromBase64String(parts[2]);
            var ciphertext = Convert.FromBase64String(parts[3]);

            if (nonce.Length != NonceSize || tag.Length != TagSize)
                throw new CryptographicException("Invalid Data Protection key envelope.");

            var plaintext = new byte[ciphertext.Length];
            using var aes = new AesGcm(material.Key, TagSize);
            aes.Decrypt(nonce, ciphertext, tag, plaintext);
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (FormatException exception)
        {
            throw new CryptographicException("Invalid Data Protection key envelope.", exception);
        }
    }
}
