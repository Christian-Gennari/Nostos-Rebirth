using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining.Import;

/// <summary>
/// Builds a deterministic, read-only import plan from the six legacy Reading
/// Training files. It never opens a database, creates books, or mutates input.
/// </summary>
public sealed partial class HermesReadingImportPlanner
{
    public HermesImportDryRunReport Plan(
        string sourceDirectory,
        IReadOnlyList<LibraryBookCandidate> library,
        IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
        HermesImportLimits? limits = null)
    {
        ArgumentNullException.ThrowIfNull(sourceDirectory);
        ArgumentNullException.ThrowIfNull(library);
        explicitBookMappings ??= new Dictionary<string, Guid>(StringComparer.Ordinal);
        limits ??= new HermesImportLimits();

        var blockers = new List<HermesImportIssue>();
        var warnings = new List<HermesImportIssue>();
        var skips = new List<HermesImportSkip>();
        var files = new SourceFileSet(limits);
        files.Read(sourceDirectory);
        blockers.AddRange(files.Blockers);

        var checksums = files.Files.Values
            .OrderBy(x => x.Name, StringComparer.Ordinal)
            .Select(x => new HermesFileChecksum(x.Name, x.Length, x.Sha256))
            .ToArray();
        var sourceLines = files.Files.Values
            .OrderBy(x => x.Name, StringComparer.Ordinal)
            .Select(x => new HermesFileLines(x.Name, CountLines(x.Bytes)))
            .ToArray();

        HermesSourceConfig? config = null;
        HermesSourceState? state = null;
        var queueMirrorBooks = new List<HermesSourceBook>();
        var activeMirror = new HermesSourceActiveMirror(false, false);
        var sessions = new List<HermesSourceSession>();
        var ratings = new List<HermesSourceRatingEvent>();
        var ratingsSkipped = new List<HermesSourceRatingSkippedEvent>();
        var actualMinutes = new List<HermesSourceActualMinutesEvent>();
        var captures = new List<HermesSourceCapture>();
        var logRecords = 0;
        var inboxRecords = 0;
        var dispositionRecords = 0;
        var mirrorRecords = 0;
        var otherLog = 0;
        var otherInbox = 0;

        if (TryFile(files, "config.yaml", out var configFile))
            config = ParseConfig(configFile, blockers);
        if (TryFile(files, "training-state.json", out var stateFile))
            state = ParseState(stateFile, blockers);
        if (TryFile(files, "reading-queue.yaml", out var queueFile))
            ParseQueueMirror(queueFile, queueMirrorBooks, blockers);
        if (TryFile(files, "active-session.json", out var activeFile))
            activeMirror = ParseActiveMirror(activeFile, blockers);
        if (TryFile(files, "reading-log.jsonl", out var logFile))
            ParseLog(logFile, limits, sessions, ratings, ratingsSkipped, actualMinutes,
                ref logRecords, ref otherLog, blockers);
        if (TryFile(files, "reading-inbox.jsonl", out var inboxFile))
            ParseInbox(inboxFile, limits, captures, ref inboxRecords,
                ref dispositionRecords, ref mirrorRecords, ref otherInbox, blockers);

        if (state?.OpenSession is not null)
        {
            blockers.Add(new HermesImportIssue(
                HermesImportCodes.OpenSessionPending,
                "the source has an open session; complete or cancel it before cutover",
                "training-state.json"));
        }
        if (activeMirror.ClaimsOpen && state?.OpenSession is null)
            warnings.Add(new HermesImportIssue(HermesImportCodes.ActiveMirrorMismatch,
                "active-session.json claims an open session but training-state.json does not",
                "active-session.json"));

        ApplyEvidence(sessions, ratings, ratingsSkipped, actualMinutes, skips);
        var retainedSessions = sessions
            .Where(s => !SkipIncident(s, skips))
            .GroupBy(s => s.SessionId, StringComparer.Ordinal)
            .Select(g =>
            {
                if (g.Count() > 1)
                    foreach (var duplicate in g.Skip(1))
                        skips.Add(new HermesImportSkip(HermesImportCodes.DuplicateSessionId,
                            "duplicate source session id", "reading-log.jsonl",
                            duplicate.Line, duplicate.SessionId));
                return g.First();
            })
            .ToList();

        var sourceBooks = CollectBooks(state, queueMirrorBooks, retainedSessions, captures);
        if (state is not null)
        {
            foreach (var duplicate in state.Queue.GroupBy(x => x.Id, StringComparer.Ordinal)
                         .Where(x => x.Count() > 1).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                blockers.Add(new(HermesImportCodes.DuplicateQueueEntry,
                    "duplicate source queue id", "training-state.json"));
            }
        }
        var decisions = ReconcileBooks(sourceBooks, library, explicitBookMappings, blockers);
        var resolved = decisions.Where(d => d.BookId.HasValue)
            .ToDictionary(d => d.SourceBookId, d => d.BookId!.Value, StringComparer.Ordinal);

        var programme = config is not null && state is not null
            ? BuildProgramme(config, state.Programme, warnings)
            : null;
        var assignments = state is null
            ? new List<HermesPlannedAssignment>()
            : BuildAssignments(state.Queue, resolved, warnings, skips);
        var assignmentBySource = assignments.ToDictionary(a => a.SourceBookId, a => a.Id, StringComparer.Ordinal);
        var ratingSkippedIds = ratingsSkipped.Select(x => x.SessionId).ToHashSet(StringComparer.Ordinal);
        var plannedSessions = BuildSessions(retainedSessions, resolved, assignmentBySource,
            ratingSkippedIds, warnings, skips);
        var sessionIds = plannedSessions.ToDictionary(s => s.SourceSessionId, s => s.Id, StringComparer.Ordinal);
        var plannedCaptures = BuildCaptures(captures, resolved, sessionIds, skips);

        var sourceCounts = new HermesSourceCounts(
            state?.Queue.Count ?? 0,
            queueMirrorBooks.Count,
            activeMirror.Present,
            state?.OpenSession is not null || activeMirror.ClaimsOpen,
            logRecords,
            sessions.Count,
            ratings.Count,
            ratingsSkipped.Count,
            actualMinutes.Count,
            otherLog,
            inboxRecords,
            captures.Count,
            dispositionRecords,
            mirrorRecords,
            otherInbox);
        var plannedCounts = new HermesPlannedCounts(
            programme is null ? 0 : 1,
            assignments.Count,
            plannedSessions.Count(s => s.Status == ReadingSessionStatus.Completed),
            plannedSessions.Count(s => s.Status == ReadingSessionStatus.Cancelled),
            plannedCaptures.Count(c => c.Type == ReadingCaptureType.Thought),
            plannedCaptures.Count(c => c.Type == ReadingCaptureType.Question),
            plannedCaptures.Count(c => c.Type == ReadingCaptureType.Bookmark));

        return new HermesImportDryRunReport(
            blockers.Count != 0,
            checksums,
            files.AggregateFingerprint(),
            sourceCounts,
            sourceLines,
            plannedCounts,
            programme,
            assignments,
            plannedSessions,
            plannedCaptures,
            decisions,
            blockers.OrderBy(x => x.File, StringComparer.Ordinal).ThenBy(x => x.Line).ThenBy(x => x.Code, StringComparer.Ordinal).ToArray(),
            warnings.OrderBy(x => x.File, StringComparer.Ordinal).ThenBy(x => x.Line).ThenBy(x => x.Code, StringComparer.Ordinal).ToArray(),
            skips.OrderBy(x => x.File, StringComparer.Ordinal).ThenBy(x => x.Line).ThenBy(x => x.Code, StringComparer.Ordinal).ToArray());
    }

    private static HermesSourceConfig? ParseConfig(ReadFileResult file, List<HermesImportIssue> blockers)
    {
        var parsed = StrictYaml.Parse(Encoding.UTF8.GetString(file.Bytes));
        if (!YamlRoot(parsed, file.Name, blockers, out var root)) return null;
        if (!root.TryGetString("timezone", out var timezone) || string.IsNullOrWhiteSpace(timezone) ||
            root.Get("initial_targets") is not { IsMapping: true } targets ||
            !targets.TryGetInt("endurance_minutes", out var endurance) ||
            !targets.TryGetInt("deep_minutes", out var deep) ||
            !targets.TryGetInt("recovery_minutes", out var recovery))
        {
            blockers.Add(Invalid(file.Name, "config.yaml is missing timezone or initial targets"));
            return null;
        }
        return new HermesSourceConfig(timezone, endurance, deep, recovery);
    }

    private static HermesSourceState? ParseState(ReadFileResult file, List<HermesImportIssue> blockers)
    {
        var parsed = StrictJson.Parse(file.Bytes);
        if (!JsonRoot(parsed, file.Name, blockers, out var root)) return null;
        if (!root.TryGetInt("schema_version", out var version) || version != 1 ||
            root.Get("targets") is not { IsObject: true } targets ||
            root.Get("established_targets") is not { IsObject: true } established ||
            root.Get("consecutive_increases") is not { IsObject: true } increases ||
            root.Get("deloaded") is not { IsObject: true } deloaded ||
            root.Get("deload_week") is not { IsObject: true } deloadWeek ||
            root.Get("queue") is not { IsArray: true } queue ||
            !targets.TryGetInt("endurance", out var endurance) ||
            !targets.TryGetInt("deep", out var deep) ||
            !targets.TryGetInt("recovery", out var recovery) ||
            !established.TryGetInt("endurance", out var establishedEndurance) ||
            !established.TryGetInt("deep", out var establishedDeep) ||
            !established.TryGetInt("recovery", out var establishedRecovery))
        {
            blockers.Add(Invalid(file.Name, "training-state.json does not match schema version 1"));
            return null;
        }
        increases.TryGetInt("endurance", out var enduranceIncreases);
        increases.TryGetInt("deep", out var deepIncreases);
        deloaded.TryGetBool("endurance", out var enduranceDeloaded);
        deloaded.TryGetBool("deep", out var deepDeloaded);
        deloadWeek.TryGetStringOrNull("endurance", out var enduranceDeloadWeek);
        deloadWeek.TryGetStringOrNull("deep", out var deepDeloadWeek);
        root.TryGetString("training_phase", out var phase);
        root.TryGetStringOrNull("initialized_at", out var initializedAt);
        var books = new List<HermesSourceBook>();
        for (var i = 0; i < queue.Items.Count; i++)
        {
            var book = ParseBook(queue.Items[i], i);
            if (book is null) blockers.Add(Invalid(file.Name, $"queue entry {i} is invalid"));
            else books.Add(book);
        }
        HermesSourceOpenSession? open = null;
        var active = root.Get("active");
        if (active is { Kind: JsonNodeKind.Object } &&
            active.TryGetString("session_id", out var sid) && !string.IsNullOrEmpty(sid) &&
            active.TryGetString("status", out var status) && !string.IsNullOrEmpty(status))
            open = new HermesSourceOpenSession(sid, status);
        var programme = new HermesSourceProgrammeState(
            endurance, deep, recovery, establishedEndurance, establishedDeep, establishedRecovery,
            enduranceDeloaded, deepDeloaded, enduranceDeloadWeek, deepDeloadWeek,
            enduranceIncreases, deepIncreases, phase ?? "base_building", initializedAt);
        return new HermesSourceState(programme, books, open);
    }

    private static HermesSourceBook? ParseBook(JsonNode node, int order)
    {
        if (!node.IsObject ||
            !node.TryGetString("id", out var id) || string.IsNullOrWhiteSpace(id) ||
            !node.TryGetString("title", out var title) || string.IsNullOrWhiteSpace(title) ||
            !node.TryGetString("author", out var author) || string.IsNullOrWhiteSpace(author) ||
            !node.TryGetString("current_mode", out var mode) ||
            !node.TryGetString("status", out var status)) return null;
        node.TryGetStringOrNull("thought_note", out var thoughtNote);
        node.TryGetStringOrNull("source_record", out var sourceRecord);
        node.TryGetStringOrNull("edition_id", out var editionId);
        node.TryGetStringOrNull("added_at", out var addedAt);
        node.TryGetStringOrNull("completed_at", out var completedAt);
        return new HermesSourceBook(id, title, author, mode ?? "", status ?? "", thoughtNote,
            sourceRecord, editionId, addedAt, completedAt, order);
    }

    private static void ParseQueueMirror(ReadFileResult file, List<HermesSourceBook> books, List<HermesImportIssue> blockers)
    {
        var parsed = StrictYaml.Parse(Encoding.UTF8.GetString(file.Bytes));
        if (!YamlRoot(parsed, file.Name, blockers, out var root)) return;
        foreach (var (bucketName, status) in new[] { ("active", "reading"), ("up_next", "queued") })
        {
            var bucket = root.Get(bucketName);
            if (bucket is not { IsMapping: true }) continue;
            foreach (var (mode, sequence) in bucket.Mapping)
                if (sequence.IsSequence)
                    foreach (var item in sequence.Sequence)
                        if (ParseYamlBook(item, mode, status, books.Count) is { } book) books.Add(book);
        }
        if (root.Get("completed") is { IsSequence: true } completed)
            foreach (var item in completed.Sequence)
                if (ParseYamlBook(item, "endurance", "completed", books.Count) is { } book) books.Add(book);
    }

    private static HermesSourceBook? ParseYamlBook(YamlNode node, string mode, string status, int order)
    {
        if (!node.IsMapping || !node.TryGetString("id", out var id) || string.IsNullOrWhiteSpace(id) ||
            !node.TryGetString("title", out var title) || string.IsNullOrWhiteSpace(title) ||
            !node.TryGetString("author", out var author) || string.IsNullOrWhiteSpace(author)) return null;
        node.TryGetString("current_mode", out var sourceMode);
        node.TryGetString("status", out var sourceStatus);
        node.TryGetStringOrNull("thought_note", out var thoughtNote);
        node.TryGetStringOrNull("source_record", out var sourceRecord);
        node.TryGetStringOrNull("edition_id", out var editionId);
        node.TryGetStringOrNull("added_at", out var addedAt);
        node.TryGetStringOrNull("completed_at", out var completedAt);
        return new HermesSourceBook(id, title, author, sourceMode ?? mode, sourceStatus ?? status,
            thoughtNote, sourceRecord, editionId, addedAt, completedAt, order);
    }

    private static HermesSourceActiveMirror ParseActiveMirror(ReadFileResult file, List<HermesImportIssue> blockers)
    {
        var parsed = StrictJson.Parse(file.Bytes);
        if (!JsonRoot(parsed, file.Name, blockers, out var root)) return new(false, false);
        if (!root.TryGetInt("schema_version", out var version) || version != 1 ||
            !root.TryGetBool("active", out var active))
        {
            blockers.Add(Invalid(file.Name, "active-session.json does not match schema version 1"));
            return new(true, false);
        }
        return new(true, active);
    }

    private static void ParseLog(ReadFileResult file, HermesImportLimits limits,
        List<HermesSourceSession> sessions, List<HermesSourceRatingEvent> ratings,
        List<HermesSourceRatingSkippedEvent> ratingsSkipped,
        List<HermesSourceActualMinutesEvent> actualMinutes, ref int records, ref int other,
        List<HermesImportIssue> blockers)
    {
        foreach (var (line, number) in JsonLines(file, limits, blockers))
        {
            records++;
            if (!line.TryGetString("record_type", out var type)) type = "session";
            switch (type)
            {
                case "session":
                    if (ParseSession(line, number) is { } session) sessions.Add(session);
                    else blockers.Add(Invalid(file.Name, "invalid session record", number));
                    break;
                case "rating":
                    if (line.TryGetString("session_id", out var ratingSid) && ratingSid is not null &&
                        line.TryGetInt("effort", out var effort) && line.TryGetInt("focus", out var focus))
                        ratings.Add(new(ratingSid, effort, focus, number));
                    else blockers.Add(Invalid(file.Name, "invalid rating record", number));
                    break;
                case "rating_skipped":
                    if (line.TryGetString("session_id", out var skippedSid) && skippedSid is not null)
                        ratingsSkipped.Add(new(skippedSid, number));
                    else blockers.Add(Invalid(file.Name, "invalid rating-skipped record", number));
                    break;
                case "actual_minutes":
                    if (line.TryGetString("session_id", out var minutesSid) && minutesSid is not null &&
                        line.TryGetInt("minutes", out var minutes)) actualMinutes.Add(new(minutesSid, minutes, number));
                    else blockers.Add(Invalid(file.Name, "invalid actual-minutes record", number));
                    break;
                default: other++; break;
            }
        }
    }

    private static HermesSourceSession? ParseSession(JsonNode node, long line)
    {
        if (!node.TryGetString("session_id", out var id)) node.TryGetString("id", out id);
        if (string.IsNullOrWhiteSpace(id) || !node.TryGetString("status", out var status) ||
            !node.TryGetString("mode", out var mode) ||
            !node.TryGetString("book_id", out var bookId)) return null;
        node.TryGetString("book_title", out var title); if (title is null) node.TryGetString("book", out title);
        node.TryGetString("author", out var author);
        ReadInt(node, "planned_target", "planned_target_minutes", out var planned);
        ReadInt(node, "session_target", "target_minutes", out var target);
        node.TryGetStringOrNull("constraint", out var constraint);
        node.TryGetBool("progression_eligible", out var eligible);
        node.TryGetBool("counts_as_failure", out var failure);
        node.TryGetStringOrNull("started_at", out var started);
        node.TryGetStringOrNull("done_at", out var done);
        node.TryGetStringOrNull("date", out var date);
        node.TryGetInt("active_seconds", out var seconds);
        node.TryGetInt("clock_minutes", out var clock);
        node.TryGetInt("actual_minutes", out var actual);
        int? reported = node.TryGetInt("reported_minutes", out var report) ? report : null;
        int? effort = node.TryGetInt("effort", out var e) ? e : null;
        int? focus = node.TryGetInt("focus", out var f) ? f : null;
        node.TryGetBool("completed_target", out var completedTarget);
        node.TryGetBool("completed_planned_target", out var completedPlanned);
        node.TryGetStringOrNull("notes", out var notes);
        node.TryGetStringOrNull("incident_marker", out var incident);
        node.TryGetBool("accidental", out var accidental);
        return new(id, status ?? "", mode ?? "", bookId ?? "", title ?? "", author ?? "",
            planned, target, constraint, eligible, failure, started, done, date, seconds, clock,
            actual, reported, effort, focus, completedTarget, completedPlanned, notes, incident,
            accidental, line);
    }

    private static void ParseInbox(ReadFileResult file, HermesImportLimits limits,
        List<HermesSourceCapture> captures, ref int records, ref int dispositions,
        ref int mirrors, ref int other, List<HermesImportIssue> blockers)
    {
        var dispositionByCapture = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (line, number) in JsonLines(file, limits, blockers))
        {
            records++;
            line.TryGetString("record_type", out var type);
            if (type == "capture")
            {
                if (!line.TryGetString("id", out var id) || string.IsNullOrWhiteSpace(id) ||
                    !line.TryGetString("type", out var captureType) ||
                    !line.TryGetString("text", out var text) || text is null ||
                    !line.TryGetString("captured_at", out var capturedAt) || capturedAt is null ||
                    !line.TryGetString("book_id", out var bookId) || bookId is null)
                { blockers.Add(Invalid(file.Name, "invalid capture record", number)); continue; }
                line.TryGetStringOrNull("date", out var date);
                line.TryGetString("book_title", out var bookTitle);
                line.TryGetStringOrNull("session_id", out var sessionId);
                line.TryGetStringOrNull("turn_id", out var turnId);
                captures.Add(new(id, captureType ?? "", text, capturedAt, date, bookId,
                    bookTitle ?? "", sessionId, turnId, false, null, number));
            }
            else if (type == "capture_disposition")
            {
                dispositions++;
                if (line.TryGetString("capture_id", out var captureId) && captureId is not null &&
                    line.TryGetString("disposition", out var disposition) && disposition is not null)
                    dispositionByCapture[captureId] = disposition;
            }
            else if (type == "mirror_completed") mirrors++;
            else other++;
        }
        for (var i = 0; i < captures.Count; i++)
            if (dispositionByCapture.TryGetValue(captures[i].Id, out var disposition))
                captures[i] = captures[i] with { Resolved = true, LastDisposition = disposition };
    }

    private static IEnumerable<(JsonNode Node, long Line)> JsonLines(
        ReadFileResult file, HermesImportLimits limits, List<HermesImportIssue> blockers)
    {
        var bytes = file.Bytes;
        var start = 0;
        var line = 1L;
        var emitted = 0;
        for (var i = 0; i <= bytes.Length; i++)
        {
            if (i != bytes.Length && bytes[i] != (byte)'\n') continue;
            var length = i - start;
            if (length > 0 && bytes[i - 1] == (byte)'\r') length--;
            if (length > limits.MaxLineBytes)
            { blockers.Add(new(HermesImportCodes.FileTooLarge, "JSONL line exceeds configured limit", file.Name, line)); yield break; }
            if (bytes.AsSpan(start, length).TrimAscii().Length != 0)
            {
                emitted++;
                if (emitted > limits.MaxJsonlLines)
                { blockers.Add(new(HermesImportCodes.FileTooManyLines, "JSONL record count exceeds configured limit", file.Name, line)); yield break; }
                var parsed = StrictJson.Parse(bytes.AsSpan(start, length));
                if (parsed.Root is null)
                    blockers.Add(new(HermesImportCodes.MalformedJson,
                        parsed.Error?.StartsWith("duplicate property", StringComparison.Ordinal) == true
                            ? "JSONL record has a duplicate property" : "malformed JSONL record",
                        file.Name, line));
                else if (!parsed.Root.IsObject)
                    blockers.Add(Invalid(file.Name, "JSONL record must be an object", line));
                else yield return (parsed.Root, line);
            }
            start = i + 1;
            line++;
        }
    }

    private static void ApplyEvidence(List<HermesSourceSession> sessions,
        List<HermesSourceRatingEvent> ratings, List<HermesSourceRatingSkippedEvent> skipped,
        List<HermesSourceActualMinutesEvent> actual, List<HermesImportSkip> skips)
    {
        for (var i = 0; i < sessions.Count; i++)
        {
            var session = sessions[i];
            var rating = ratings.LastOrDefault(x => x.SessionId == session.SessionId);
            var minute = actual.LastOrDefault(x => x.SessionId == session.SessionId);
            if (rating is not null) session = session with { Effort = rating.Effort, Focus = rating.Focus };
            if (minute is not null) session = session with { ActualMinutes = minute.Minutes, ReportedMinutes = minute.Minutes };
            sessions[i] = session;
        }
        foreach (var rating in ratings.Where(r => sessions.All(s => s.SessionId != r.SessionId)))
            skips.Add(new(HermesImportCodes.UnresolvedRatingEvent, "rating references no session",
                "reading-log.jsonl", rating.Line, rating.SessionId));
        foreach (var rating in skipped.Where(r => sessions.All(s => s.SessionId != r.SessionId)))
            skips.Add(new(HermesImportCodes.UnresolvedRatingEvent, "rating-skip references no session",
                "reading-log.jsonl", rating.Line, rating.SessionId));
    }

    private static bool SkipIncident(HermesSourceSession session, List<HermesImportSkip> skips)
    {
        if (!session.AccidentalMarker && string.IsNullOrWhiteSpace(session.IncidentMarker)) return false;
        skips.Add(new(HermesImportCodes.IncidentPollution,
            "source session carries an explicit incident/accidental marker",
            "reading-log.jsonl", session.Line, session.SessionId));
        return true;
    }

    private static List<HermesSourceBook> CollectBooks(HermesSourceState? state,
        List<HermesSourceBook> mirror, List<HermesSourceSession> sessions,
        List<HermesSourceCapture> captures)
    {
        var result = new Dictionary<string, HermesSourceBook>(StringComparer.Ordinal);
        foreach (var book in state?.Queue ?? Array.Empty<HermesSourceBook>()) result[book.Id] = book;
        foreach (var book in mirror) result.TryAdd(book.Id, book);
        foreach (var session in sessions)
            if (!string.IsNullOrWhiteSpace(session.BookId)) result.TryAdd(session.BookId,
                new(session.BookId, session.BookTitle, session.Author, session.Mode, "completed", null, null, null, null, null, result.Count));
        foreach (var capture in captures)
            if (!string.IsNullOrWhiteSpace(capture.BookId)) result.TryAdd(capture.BookId,
                new(capture.BookId, capture.BookTitle, "", "endurance", "reading", null, null, null, null, null, result.Count));
        return result.Values.OrderBy(x => x.QueueOrder).ThenBy(x => x.Id, StringComparer.Ordinal).ToList();
    }

    private static List<HermesBookMappingDecision> ReconcileBooks(
        List<HermesSourceBook> sources, IReadOnlyList<LibraryBookCandidate> library,
        IReadOnlyDictionary<string, Guid> explicitMappings, List<HermesImportIssue> blockers)
    {
        var result = new List<HermesBookMappingDecision>();
        foreach (var source in sources)
        {
            if (explicitMappings.TryGetValue(source.Id, out var explicitId))
            {
                var target = library.FirstOrDefault(x => x.Id == explicitId);
                if (target is null)
                {
                    blockers.Add(new(HermesImportCodes.ExplicitMappingTargetMissing,
                        "explicit book mapping target does not exist"));
                    result.Add(new(source.Id, source.Title, source.Author,
                        HermesImportCodes.DecisionExplicitTargetMissing, null, null, null,
                        "explicit target is absent from the supplied library"));
                }
                else result.Add(new(source.Id, source.Title, source.Author,
                    HermesImportCodes.DecisionExplicitMatched, target.Id, target.Title, target.Author,
                    "matched by explicit source-id mapping"));
                continue;
            }
            var key = NormalizeBook(source.Title, source.Author);
            var matches = library.Where(x => NormalizeBook(x.Title, x.Author) == key).ToArray();
            if (matches.Length == 1)
                result.Add(new(source.Id, source.Title, source.Author,
                    HermesImportCodes.DecisionUniqueAuto, matches[0].Id, matches[0].Title,
                    matches[0].Author, "unique normalized title and author match"));
            else if (matches.Length == 0)
            {
                blockers.Add(new(HermesImportCodes.BookNotFound,
                    "source book has no unique library match; provide an explicit mapping"));
                result.Add(new(source.Id, source.Title, source.Author,
                    HermesImportCodes.DecisionNotFound, null, null, null, "no normalized match"));
            }
            else
            {
                blockers.Add(new(HermesImportCodes.BookAmbiguous,
                    "source book has multiple library matches; provide an explicit mapping"));
                result.Add(new(source.Id, source.Title, source.Author,
                    HermesImportCodes.DecisionAmbiguous, null, null, null, "multiple normalized matches"));
            }
        }
        return result;
    }

    private static HermesPlannedProgramme BuildProgramme(HermesSourceConfig config,
        HermesSourceProgrammeState state, List<HermesImportIssue> warnings)
    {
        var initialized = ParseTimestamp(state.InitializedAt, "training-state.json", warnings);
        return new(DeterministicGuid.ProgrammeId, config.TimezoneId,
            config.BaselineEnduranceMinutes, config.BaselineDeepMinutes,
            config.BaselineRecoveryMinutes, state.EnduranceTargetMinutes,
            state.DeepTargetMinutes, state.RecoveryTargetMinutes,
            state.EnduranceEstablishedMinutes, state.DeepEstablishedMinutes,
            state.RecoveryEstablishedMinutes, state.EnduranceDeloaded, state.DeepDeloaded,
            state.EnduranceDeloadWeek, state.DeepDeloadWeek,
            state.EnduranceConsecutiveIncreases, state.DeepConsecutiveIncreases,
            state.TrainingPhase, initialized, state.InitializedAt);
    }

    private static List<HermesPlannedAssignment> BuildAssignments(
        IReadOnlyList<HermesSourceBook> books, Dictionary<string, Guid> resolved,
        List<HermesImportIssue> warnings, List<HermesImportSkip> skips)
    {
        var result = new List<HermesPlannedAssignment>();
        var defaultModes = new HashSet<ReadingMode>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var book in books)
        {
            if (!seen.Add(book.Id)) continue;
            if (!resolved.TryGetValue(book.Id, out var bookId)) continue;
            if (!TryMode(book.CurrentMode, out var mode))
            { skips.Add(new(HermesImportCodes.UnrecognizedQueueMode, "unrecognized queue mode", SourceId: book.Id)); continue; }
            if (!TryAssignmentStatus(book.Status, out var status))
            { skips.Add(new(HermesImportCodes.UnrecognizedQueueStatus, "unrecognized queue status", SourceId: book.Id)); continue; }
            var isDefault = status == ReadingAssignmentStatus.Active && defaultModes.Add(mode);
            result.Add(new(DeterministicGuid.AssignmentFor(book.Id), bookId, book.Id,
                book.Title, book.Author, mode, status, book.QueueOrder, isDefault,
                book.ThoughtNote, book.SourceRecord, book.EditionId, book.AddedAt,
                book.CompletedAt, ParseTimestamp(book.AddedAt, "training-state.json", warnings),
                ParseTimestamp(book.CompletedAt, "training-state.json", warnings)));
        }
        return result;
    }

    private static List<HermesPlannedSession> BuildSessions(List<HermesSourceSession> sources,
        Dictionary<string, Guid> resolved, Dictionary<string, Guid> assignments,
        HashSet<string> ratingSkippedIds, List<HermesImportIssue> warnings,
        List<HermesImportSkip> skips)
    {
        var result = new List<HermesPlannedSession>();
        foreach (var source in sources)
        {
            if (!resolved.TryGetValue(source.BookId, out var bookId)) continue;
            if (!TryMode(source.Mode, out var mode))
            { skips.Add(new(HermesImportCodes.UnrecognizedMode, "unrecognized session mode", "reading-log.jsonl", source.Line, source.SessionId)); continue; }
            if (!TrySessionStatus(source.Status, out var status))
            { skips.Add(new(HermesImportCodes.UnrecognizedSessionStatus, "unrecognized session status", "reading-log.jsonl", source.Line, source.SessionId)); continue; }
            if (!TryConstraint(source.Constraint, out var constraint))
            { skips.Add(new(HermesImportCodes.UnrecognizedConstraint, "unrecognized constraint", "reading-log.jsonl", source.Line, source.SessionId)); continue; }
            Guid? assignmentId = null;
            if (assignments.TryGetValue(source.BookId, out var matchedAssignmentId))
            {
                assignmentId = matchedAssignmentId;
            }
            else
            {
                warnings.Add(new(HermesImportCodes.SessionBookNotInQueue,
                    "session book has no planned assignment; session linkage will be null",
                    "reading-log.jsonl", source.Line));
            }
            result.Add(new(DeterministicGuid.SessionFor(source.SessionId), source.SessionId,
                mode, status, constraint, source.SessionTarget, source.PlannedTarget,
                source.ProgressionEligible, source.CountsAsFailure,
                ParseDate(source.Date), ParseDateTime(source.StartedAt), ParseDateTime(source.DoneAt),
                source.StartedAt, source.DoneAt, source.Date, source.ActiveSeconds,
                source.ClockMinutes, source.ActualMinutes, source.ReportedMinutes,
                source.Effort, source.Focus, ratingSkippedIds.Contains(source.SessionId), source.CompletedTarget,
                source.CompletedPlannedTarget, source.Notes, source.BookId, bookId,
                assignmentId, source.Line));
        }
        return result;
    }

    private static List<HermesPlannedCapture> BuildCaptures(List<HermesSourceCapture> sources,
        Dictionary<string, Guid> resolved, Dictionary<string, Guid> sessions,
        List<HermesImportSkip> skips)
    {
        var result = new List<HermesPlannedCapture>();
        foreach (var source in sources)
        {
            if (!resolved.TryGetValue(source.BookId, out var bookId)) continue;
            if (!TryCaptureType(source.Type, out var type))
            { skips.Add(new(HermesImportCodes.UnrecognizedCaptureType, "unrecognized capture type", "reading-inbox.jsonl", source.Line, source.Id)); continue; }
            Guid? plannedSessionId = null;
            if (source.SessionId is not null && sessions.TryGetValue(source.SessionId, out var sessionId))
                plannedSessionId = sessionId;
            result.Add(new(DeterministicGuid.CaptureFor(source.Id), source.Id, type,
                source.Text, ParseDateTime(source.CapturedAt), source.CapturedAt,
                source.Date, bookId, source.BookId, source.SessionId,
                plannedSessionId,
                source.TurnId, source.Resolved, source.LastDisposition, source.Line));
        }
        return result;
    }

    private static bool JsonRoot(StrictJson.ParseResult parsed, string file,
        List<HermesImportIssue> blockers, out JsonNode root)
    {
        if (parsed.Root is { IsObject: true } value) { root = value; return true; }
        blockers.Add(new(parsed.Error?.StartsWith("duplicate property", StringComparison.Ordinal) == true
                ? HermesImportCodes.DuplicateJsonKey : HermesImportCodes.MalformedJson,
            parsed.Error is null ? "JSON root must be an object" : "malformed JSON document",
            file, parsed.ErrorLine));
        root = null!; return false;
    }

    private static bool YamlRoot(StrictYaml.ParseResult parsed, string file,
        List<HermesImportIssue> blockers, out YamlNode root)
    {
        if (parsed.Root is { IsMapping: true } value) { root = value; return true; }
        var code = parsed.Error?.StartsWith("duplicate key", StringComparison.Ordinal) == true
            ? HermesImportCodes.DuplicateYamlKey
            : parsed.Error?.Contains("tag", StringComparison.Ordinal) == true
                ? HermesImportCodes.UnsafeYamlTag
                : parsed.Error?.Contains("anchor", StringComparison.Ordinal) == true || parsed.Error?.Contains("alias", StringComparison.Ordinal) == true
                    ? HermesImportCodes.UnsafeYamlAlias : HermesImportCodes.MalformedYaml;
        blockers.Add(new(code, parsed.Error is null ? "YAML root must be a mapping" : "malformed or unsafe YAML document", file, parsed.ErrorLine));
        root = null!; return false;
    }

    private static bool TryFile(SourceFileSet files, string name, out ReadFileResult file) =>
        files.Files.TryGetValue(name, out file!);
    private static HermesImportIssue Invalid(string file, string detail, long? line = null) =>
        new(HermesImportCodes.InvalidSource, detail, file, line);
    private static long CountLines(byte[] bytes) => bytes.Length == 0 ? 0 : bytes.LongCount(b => b == (byte)'\n') + (bytes[^1] == (byte)'\n' ? 0 : 1);
    private static string NormalizeBook(string title, string author) =>
        $"{Collapse(title.Normalize(NormalizationForm.FormKC))}\u001f{Collapse(author.Normalize(NormalizationForm.FormKC))}";
    private static string Collapse(string value) => Whitespace().Replace(value.Trim(), " ").ToUpperInvariant();
    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)] private static partial Regex Whitespace();

    private static bool ReadInt(JsonNode node, string first, string second, out int value) =>
        node.TryGetInt(first, out value) || node.TryGetInt(second, out value);
    private static bool TryMode(string value, out ReadingMode mode) => Enum.TryParse(value, true, out mode);
    private static bool TryAssignmentStatus(string value, out ReadingAssignmentStatus status)
    {
        status = value.ToLowerInvariant() switch { "reading" => ReadingAssignmentStatus.Active, "queued" => ReadingAssignmentStatus.Queued, "completed" => ReadingAssignmentStatus.Completed, _ => (ReadingAssignmentStatus)(-1) };
        return (int)status >= 0;
    }
    private static bool TrySessionStatus(string value, out ReadingSessionStatus status)
    {
        status = value.ToLowerInvariant() switch { "completed" => ReadingSessionStatus.Completed, "cancelled" => ReadingSessionStatus.Cancelled, _ => (ReadingSessionStatus)(-1) };
        return (int)status >= 0;
    }
    private static bool TryConstraint(string? value, out ReadingConstraint constraint)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Equals("none", StringComparison.OrdinalIgnoreCase)) { constraint = ReadingConstraint.None; return true; }
        if (value.Equals("time", StringComparison.OrdinalIgnoreCase) || value.Equals("time_constrained", StringComparison.OrdinalIgnoreCase)) { constraint = ReadingConstraint.TimeConstrained; return true; }
        if (value.Equals("fatigue", StringComparison.OrdinalIgnoreCase) || value.Equals("fatigue_constrained", StringComparison.OrdinalIgnoreCase)) { constraint = ReadingConstraint.FatigueConstrained; return true; }
        constraint = default; return false;
    }
    private static bool TryCaptureType(string value, out ReadingCaptureType type) => Enum.TryParse(value, true, out type);
    private static DateTimeOffset? ParseDateTime(string? value) => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed) ? parsed : null;
    private static DateTimeOffset? ParseDate(string? value) => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed : null;
    private static DateTimeOffset? ParseTimestamp(string? value, string file, List<HermesImportIssue> warnings)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parsed = ParseDateTime(value);
        if (parsed is null) warnings.Add(new(HermesImportCodes.UnparseableTimestamp, "source timestamp could not be parsed", file));
        return parsed;
    }
}

internal static class ByteSpanExtensions
{
    public static ReadOnlySpan<byte> TrimAscii(this ReadOnlySpan<byte> value)
    {
        var start = 0; var end = value.Length;
        while (start < end && value[start] is (byte)' ' or (byte)'\t' or (byte)'\r') start++;
        while (end > start && value[end - 1] is (byte)' ' or (byte)'\t' or (byte)'\r') end--;
        return value[start..end];
    }
}
