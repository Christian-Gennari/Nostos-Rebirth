namespace Nostos.Backend.Providers.Contracts;

/// <summary>
/// The finished local artifact: one file, in the format the library will store
/// it as. This is what the acquisition pipeline hands to storage, and it is the
/// only thing that outlives the staging directory.
/// </summary>
public sealed record AcquisitionArtifact(string FilePath, string FileExtension, string ContentType);

/// <summary>
/// A part as it actually landed on disk. <see cref="FilePath"/> is a path the
/// acquisition layer generated inside its own staging directory — never anything
/// derived from a remote filename.
/// </summary>
public sealed record AcquisitionPart(string FilePath, string FileExtension, long Bytes);

/// <summary>
/// Everything a provider-specific assembly step needs. The working directory is
/// private to this acquisition and is removed once it finishes, so an assembler
/// may put intermediates there freely.
/// </summary>
public sealed record AcquisitionAssemblyContext(
    ProviderAcquisitionPlan Plan,
    IReadOnlyList<AcquisitionPart> Parts,
    string WorkingDirectory);

/// <summary>
/// Turns downloaded parts into the one file the library will hold.
///
/// Only providers whose material actually needs combining implement this — a
/// multi-track audiobook being the case in point. A provider that already
/// delivers a single usable file simply does not implement it, and that
/// downloaded part is the artifact.
///
/// Resolved through the provider registry like every other capability, so there
/// is no "look up an assembler by provider id" indirection that could silently
/// find nothing: a provider that declares
/// <see cref="ProviderCapabilities.RequiresAssembly"/> and does not implement
/// this fails at startup instead.
/// </summary>
public interface IAcquisitionAssembler
{
    Task<AcquisitionArtifact> AssembleAsync(AcquisitionAssemblyContext context, CancellationToken ct);
}
