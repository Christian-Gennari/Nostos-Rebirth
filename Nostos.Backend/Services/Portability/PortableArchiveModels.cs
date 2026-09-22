namespace Nostos.Backend.Services.Portability;

internal static class PortableArchiveFormat
{
    public const string Name = "nostos-portable";
    public const int Version = 1;
    public const int DataVersion = 1;
    public const string ManifestPath = "manifest.json";
    public const string DataPath = "data/library.json";
    public const string BookMediaKind = "book";
    public const string CoverMediaKind = "cover";
}

internal sealed record PortableLibraryData(
    int Version,
    List<PortableWork> Works,
    List<PortableBook> Books,
    List<PortableCollection> Collections,
    List<PortableBookCollection> BookCollections,
    List<PortableNote> Notes,
    List<PortableConcept> Concepts,
    List<PortableNoteConcept> NoteConcepts,
    List<PortableWriting> Writings,
    List<PortableBookAcquisition> BookAcquisitions,
    PortableAssistantSettings? AssistantSettings);

internal sealed record PortableWork(
    Guid Id,
    string Title,
    string? Author,
    DateTime CreatedAt);

internal sealed record PortableBook(
    Guid Id,
    Guid WorkId,
    string Type,
    string Status,
    string? StatusMessage,
    string Title,
    string? Author,
    PortableBookMetadata Metadata,
    PortableReadingProgress Progress,
    DateTime CreatedAt,
    string? Isbn,
    int? PageCount,
    string? Asin,
    string? Duration,
    string? Narrator,
    string? ChaptersJson,
    bool HasBookFile,
    bool HasCover);

internal sealed record PortableBookMetadata(
    string? Subtitle,
    string? Description,
    string? Editor,
    string? Translator,
    string? Publisher,
    string? PlaceOfPublication,
    string? PublishedDate,
    string? Language,
    string? Categories,
    string? Edition,
    string? Series,
    string? VolumeNumber);

internal sealed record PortableReadingProgress(
    string? LastLocation,
    int ProgressPercent,
    int Rating,
    bool IsFavorite,
    string? PersonalReview,
    DateTime? LastReadAt,
    DateTime? FinishedAt);

internal sealed record PortableCollection(
    Guid Id,
    string Name,
    Guid? ParentId);

internal sealed record PortableBookCollection(
    Guid BookId,
    Guid CollectionId,
    DateTime AddedAt);

internal sealed record PortableNote(
    Guid Id,
    string Content,
    string? CfiRange,
    string? SelectedText,
    DateTime CreatedAt,
    Guid BookId,
    string? RawContent,
    string CaptureSource,
    string ProcessingMode,
    string SourceAnchorKind,
    string? SourceAnchorValue,
    bool AnchorVerified);

internal sealed record PortableConcept(
    Guid Id,
    string Concept);

internal sealed record PortableNoteConcept(
    Guid NoteId,
    Guid ConceptId);

internal sealed record PortableWriting(
    Guid Id,
    string Name,
    string Type,
    string? Content,
    Guid? ParentId,
    DateTime CreatedAt,
    DateTime UpdatedAt);

internal sealed record PortableBookAcquisition(
    Guid Id,
    Guid BookId,
    string ProviderId,
    string ProviderDisplayName,
    string ExternalId,
    string AssetId,
    string? AssetFormat,
    string? ImportedExtension,
    string? SourceUrl,
    string? RightsStatement,
    DateTime AcquiredAt);

internal sealed record PortableAssistantSettings(
    string? CaptureProcessingMode,
    DateTime UpdatedAtUtc);

internal sealed record StagedPortableMedia(
    PortableArchiveMediaEntry Descriptor,
    string StagedPath);

internal sealed record ValidatedPortableArchive(
    PortableArchiveManifest Manifest,
    PortableLibraryData Data,
    IReadOnlyList<StagedPortableMedia> Media);
