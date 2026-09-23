using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Configuration;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Integrations.Mcp;
using Nostos.Backend.Health;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Acquisition.Media;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Providers.Gutenberg;
using Nostos.Backend.Providers.LibriVox;
using Nostos.Backend.Serialization;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Services.Notes;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

var deployment = builder.Services.AddNostosDeployment(builder.Configuration);
builder.Services.AddNostosAuthentication(builder.Configuration, deployment);

CloudManagedAiOptions? cloudManagedAiOptions = null;
if (deployment.Mode == DeploymentMode.Cloud)
{
    cloudManagedAiOptions =
        builder.Configuration.GetSection(CloudManagedAiOptions.SectionName).Get<CloudManagedAiOptions>()
        ?? new CloudManagedAiOptions();
    cloudManagedAiOptions.Validate();
    builder.Services.AddSingleton(cloudManagedAiOptions);
}

builder.Services.Configure<BackupSettings>(builder.Configuration.GetSection("BackupSettings"));

// Where locally stored book files live. Configurable so a test host (or a
// deployment with a dedicated media volume) can point it somewhere else —
// `Storage/books` under the content root stays the default.
builder.Services.Configure<FileStorageOptions>(
    builder.Configuration.GetSection(FileStorageOptions.SectionName));

// Library receipt retention (issue #51): the bound section is normalized
// once (unsafe values clamped) and registered as a singleton so the
// retention service and its hosted worker always agree on the effective
// bounds.
builder.Services.AddSingleton(LibraryReceiptRetentionOptions.Normalize(
    builder.Configuration.GetSection("LibraryReceiptRetention").Get<LibraryReceiptRetentionOptions>()
    ?? new LibraryReceiptRetentionOptions()));

// --- MCP (Model Context Protocol) Streamable HTTP foundation (Task 9A) ---
// Opt-in and disabled by default. When enabled, the bearer token is resolved
// ONLY from the configured environment variable at startup; a missing token
// fails startup closed so the server never runs unauthenticated. The
// validated options instance is registered as a singleton so the maintenance
// guard, the authentication middleware, and the endpoint mapping always
// agree on the normalized route. The token itself is captured in the local
// `mcpApiKey` variable, never stored in configuration, logging, or responses.
var mcpOptions = builder.Configuration.GetSection("Mcp").Get<McpOptions>() ?? new McpOptions();
string mcpApiKey = string.Empty;
if (mcpOptions.Enabled)
{
    if (!McpOptions.TryNormalizePath(mcpOptions.Path, out var normalizedPath, out var pathError))
    {
        throw new InvalidOperationException(
            $"MCP is enabled but 'Mcp:Path' is invalid ({pathError}). Disable MCP (Mcp:Enabled=false) or fix the path.");
    }

    mcpOptions.Path = normalizedPath;

    if (string.IsNullOrWhiteSpace(mcpOptions.ApiKeyEnvironmentVariable))
    {
        throw new InvalidOperationException(
            "MCP is enabled but 'Mcp:ApiKeyEnvironmentVariable' is empty. Configure an environment variable name.");
    }

    var resolvedToken = Environment.GetEnvironmentVariable(mcpOptions.ApiKeyEnvironmentVariable);
    if (!string.IsNullOrWhiteSpace(resolvedToken))
    {
        mcpApiKey = resolvedToken.Trim();
    }
    else
    {
        throw new InvalidOperationException(
            $"MCP is enabled but environment variable '{mcpOptions.ApiKeyEnvironmentVariable}' is not set or empty. " +
            "Set the token before starting Nostos, or disable MCP (Mcp:Enabled=false).");
    }

    builder.Services
        .AddMcpServer(server => server.ServerInfo = new Implementation
        {
            Name = "nostos",
            Version = "1.0.0",
        })
        .WithHttpTransport()
        .WithToolsFromAssembly();
}

builder.Services.AddSingleton(mcpOptions);

// --- SPEECH-TO-TEXT (issue #262 §2/§3, Cloud #404) ---
var speechOptions =
    builder.Configuration.GetSection(SpeechOptions.SectionName).Get<SpeechOptions>()
    ?? new SpeechOptions();
builder.Services.AddSingleton(speechOptions);

if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddHttpClient(NineRouterSttProvider.HttpClientName, client =>
    {
        client.Timeout = TimeSpan.FromMinutes(5);
    });
    builder.Services.AddSingleton<ISTtProvider, NineRouterSttProvider>();
}
else
{
    builder.Services.AddHttpClient(GroqManagedSttProvider.HttpClientName, client =>
    {
        client.Timeout = TimeSpan.FromSeconds(cloudManagedAiOptions!.SttRequestTimeoutSeconds);
    });
    builder.Services.AddSingleton<ISTtProvider, GroqManagedSttProvider>();
}

// --- ASSISTANT LLM BRIDGE (issue #261 §3, §7, Cloud #404) ---
var assistantOptions =
    builder.Configuration.GetSection(AssistantOptions.SectionName).Get<AssistantOptions>()
    ?? new AssistantOptions();
builder.Services.AddSingleton(assistantOptions);

if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddHttpClient(NineRouterLlmProvider.HttpClientName, client =>
    {
        client.Timeout = TimeSpan.FromSeconds(Math.Max(1, assistantOptions.RequestTimeoutSeconds));
    });
    builder.Services.AddSingleton<ILlmProvider, NineRouterLlmProvider>();
}
else
{
    builder.Services.AddHttpClient(VercelAiGatewayManagedLlmProvider.HttpClientName, client =>
    {
        client.Timeout = TimeSpan.FromSeconds(cloudManagedAiOptions!.LlmRequestTimeoutSeconds);
    });
    builder.Services.AddSingleton<ILlmProvider, VercelAiGatewayManagedLlmProvider>();
}

// Post-processing modes (issue #262 §7, §8): one processor over the same bridge.
// It is stateless and its verbatim short-circuit never reaches the provider, so
// a singleton matches the provider's lifetime.
builder.Services.AddSingleton<IThoughtProcessor, ThoughtProcessor>();
builder.Services.AddSingleton<AssistantPlanStore>();
// The owner's one-time assistant choices, stored in the database (issue #262
// §7). It depends only on the context factory, so it has the same singleton
// lifetime as the provider settings beside it.
builder.Services.AddSingleton<IAssistantSettingsService, AssistantSettingsService>();
builder.Services.AddScoped<AssistantOrchestrator>();

if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddSingleton<IManagedAiAccessPolicy, SelfHostedManagedAiAccessPolicy>();
    builder.Services.AddSingleton<IManagedAiUsageService>(
        SelfHostedManagedAiUsageService.Instance);
}
else
{
    builder.Services.AddScoped<IManagedAiAccessPolicy, CloudManagedAiAccessPolicy>();
}

// --- AI PROVIDER SETTINGS (assistant milestone + Cloud #404) ---
builder.Services.AddNostosDataProtection(builder.Configuration, deployment);

if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddHttpClient(AiProviderSettingsService.HttpClientName, client =>
    {
        client.Timeout = TimeSpan.FromSeconds(60);
    });
    builder.Services.AddSingleton<AiProviderSettingsService>();
    builder.Services.AddSingleton<IAiProviderConfigResolver>(
        sp => sp.GetRequiredService<AiProviderSettingsService>());
    builder.Services.AddSingleton<IAiProviderSettingsService>(
        sp => sp.GetRequiredService<AiProviderSettingsService>());
}
else
{
    builder.Services.AddSingleton<CloudManagedAiProviderSettingsService>();
    builder.Services.AddSingleton<IAiProviderConfigResolver>(
        sp => sp.GetRequiredService<CloudManagedAiProviderSettingsService>());
    builder.Services.AddSingleton<IAiProviderSettingsService>(
        sp => sp.GetRequiredService<CloudManagedAiProviderSettingsService>());
}

// --- OPDS 1.2 export (issue #186) ---
// The catalogue is unauthenticated by design, so it is only safe on a private
// network; see OpdsOptions for the full access-model statement. The section is
// validated and normalized once at startup so the mapping decision, the page
// size, and the externally visible base URL can never disagree between the
// endpoint, the startup log, and the configuration file.
var opdsOptions =
    builder.Configuration.GetSection(OpdsOptions.SectionName).Get<OpdsOptions>()
    ?? new OpdsOptions();
opdsOptions.PageSize = OpdsOptions.NormalizePageSize(opdsOptions.PageSize);
if (
    !OpdsOptions.TryNormalizePublicBaseUrl(
        opdsOptions.PublicBaseUrl,
        out var opdsPublicBaseUrl,
        out var opdsBaseUrlError
    )
)
{
    throw new InvalidOperationException(
        $"OPDS is enabled but 'Opds:PublicBaseUrl' is invalid ({opdsBaseUrlError}). "
            + "Fix the URL, or unset it to derive the origin from each request."
    );
}
opdsOptions.PublicBaseUrl = opdsPublicBaseUrl;
builder.Services.AddSingleton(opdsOptions);

// Single upload cap for Kestrel + multipart forms (audiobooks can be GB-sized).
// One declaration only: a second ConfigureKestrel/Configure<FormOptions> call
// would silently overwrite the first, leaving dead config behind.
const long maxUploadSize = 4L * 1024 * 1024 * 1024; // 4GB in bytes
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSize;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSize;
});

// --- REVERSE PROXY / FORWARDED HEADERS ---
// Nostos is normally reached through a reverse proxy that terminates TLS
// (Tailscale `serve`, nginx, ...), so the request Kestrel actually receives is
// plain HTTP addressed to an internal name. Without honouring these headers
// every absolute URL the app generates is wrong: the OPDS feed advertised
// `http://` acquisition links on an `https://` catalogue, and an e-reader that
// refuses or cannot follow the downgraded link simply never gets the book.
//
// The trust list stays at its default (loopback only), which is where a local
// proxy connects from. Widening it — or clearing both lists, which means
// "trust every caller" — would let any client forge the host used in generated
// URLs, so the default is the safe one and the port of the proxy must stay on
// the loopback interface.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor
        | ForwardedHeaders.XForwardedProto
        | ForwardedHeaders.XForwardedHost;
});

builder.Services.AddNostosPersistence(
    builder.Configuration,
    deployment,
    builder.Environment.ContentRootPath);

if (deployment.Mode == DeploymentMode.Cloud)
{
    builder.Services.AddNostosCloudBilling(builder.Configuration);
}

if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddScoped<IDatabaseBootstrapService, DatabaseBootstrapService>();
}

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
});

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();

// Services Dependency Injection
if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddSingleton<FileStorageService>();
    builder.Services.AddSingleton<IFileStorageService>(
        sp => sp.GetRequiredService<FileStorageService>());
    builder.Services.AddSingleton<IBookAssetStorage>(
        sp => sp.GetRequiredService<FileStorageService>());
}
else
{
    builder.Services.AddNostosCloudObjectStorage(builder.Configuration);
    builder.Services.AddNostosCloudRecoverySchedule(builder.Configuration, deployment);
}

builder.Services.AddNostosHealthChecks(deployment);

builder.Services.AddSingleton<BackupSettingsProvider>();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient(BookLookupService.HttpClientName, client =>
{
    // External metadata lookups must never occupy the whole request budget;
    // typed failure (null) flows out of the lookup service instead.
    client.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.AddScoped<BookLookupService>();
builder.Services.AddScoped<ILibraryService, LibraryService>();
builder.Services.AddScoped<LibraryReceiptRetentionService>();
builder.Services.AddScoped<MediaMetadataService>();
builder.Services.AddScoped<NoteProcessorService>();
builder.Services.AddScoped<INoteService, NoteService>();
if (deployment.Mode == DeploymentMode.SelfHosted)
{
    builder.Services.AddScoped<IBackupService, BackupService>();
}

// Provider-independent library portability is available in both deployment
// modes. In Cloud the scoped DbContext and IBookAssetStorage already resolve
// from the authenticated tenant context; callers never supply tenant resources.
builder.Services.AddScoped<
    Nostos.Backend.Services.Portability.IPortableArchiveService,
    Nostos.Backend.Services.Portability.PortableArchiveService>();

builder.Services.AddScoped<IBookRepository, BookRepository>();
builder.Services.AddScoped<INoteRepository, NoteRepository>();
builder.Services.AddScoped<IConceptRepository, ConceptRepository>();
builder.Services.AddScoped<IWritingRepository, WritingRepository>();

// --- Safe assistant action surface (issue #260 §5, §6) ---
// One scoped registry over the canonical note/library/concept services. It has
// no HTTP surface and no LLM; 261-S2 executes it in process. The capabilities
// are built here so the registry itself stays a plain, testable collection.
builder.Services.AddScoped(sp => new AssistantCapabilityRegistry(AssistantCapabilities.Build(
    sp.GetRequiredService<INoteService>(),
    sp.GetRequiredService<ILibraryService>(),
    sp.GetRequiredService<IConceptRepository>())));

// --- External content providers and acquisition (issue #166) ---
// A provider only describes remote content; the acquisition layer turns a
// described item into an ordinary local book. Adding a source is a normal DI
// registration here — there is no dynamic assembly loading and no third-party
// plugin surface.
builder.Services.Configure<AcquisitionOptions>(
    builder.Configuration.GetSection(AcquisitionOptions.SectionName));

// Auto-redirect is deliberately OFF: the downloader follows redirects itself,
// one hop at a time, so that every hop is checked against the provider's host
// allow-list instead of only the first URL.
builder.Services.AddHttpClient(ProviderContentDownloader.HttpClientName, client =>
{
    // Per-attempt deadlines belong to the downloader, not to the client: one
    // short HttpClient timeout would kill every multi-hour audiobook download.
    client.Timeout = Timeout.InfiniteTimeSpan;
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
}).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = false,
    ConnectTimeout = TimeSpan.FromSeconds(30),
});

builder.Services.AddSingleton<IProviderRegistry, ProviderRegistry>();
builder.Services.AddSingleton<ITranscodeLimiter, TranscodeLimiter>();
builder.Services.AddSingleton<IProviderContentDownloader, ProviderContentDownloader>();
builder.Services.AddScoped<IAcquisitionService, AcquisitionService>();

// --- Project Gutenberg (#167) ---
// One identifiable client for the catalogue, with a short per-request timeout:
// Gutenberg asks to be treated politely, and a search must not hold a request
// open. The content downloads themselves use the separate provider-content
// client, which has its own (much longer) per-attempt budget.
builder.Services.AddHttpClient(GutenbergProvider.HttpClientName, client =>
{
    client.BaseAddress = new Uri(GutenbergCatalog.BaseUrl);
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
});

builder.Services.AddSingleton<IContentProvider, GutenbergProvider>();

// --- LibriVox (#168) ---
// The media tooling is an explicit runtime prerequisite, not an assumption:
// MediaProcessRunner resolves ffmpeg/ffprobe at startup and publishes whether
// they are present, so a missing dependency is a clear message at the point of
// use rather than a confusing failure halfway through an import.
builder.Services.Configure<MediaToolOptions>(
    builder.Configuration.GetSection(MediaToolOptions.SectionName));

builder.Services.AddSingleton<IMediaProcessRunner, MediaProcessRunner>();
builder.Services.AddSingleton<LibriVoxM4bAssembler>();

builder.Services.AddHttpClient(LibriVoxProvider.HttpClientName, client =>
{
    client.BaseAddress = new Uri(LibriVoxCatalog.BaseUrl);
    // The catalogue client is only used for the JSON feed, which is small and
    // fast; the section downloads use the separate provider-content client with
    // its own long per-attempt budget.
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
});

builder.Services.AddSingleton<IContentProvider, LibriVoxProvider>();

// One instance serves as the job store, the hosted worker that drains it, and
// the IAcquisitionJobManager the endpoints talk to.
builder.Services.AddSingleton<AcquisitionJobManager>();
builder.Services.AddSingleton<IAcquisitionJobManager>(sp => sp.GetRequiredService<AcquisitionJobManager>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<AcquisitionJobManager>());
builder.Services.AddHostedService<AcquisitionReconciliationWorker>();
if (deployment.Mode == DeploymentMode.SelfHosted)
{
    // These workers operate on the one local SQLite library. In Cloud there is
    // no ambient customer during a timer tick, so running them per web replica
    // would be both incorrect and duplicate work. Cloud fleet maintenance gets
    // an explicit tenant-aware owner/lease before it is enabled.
    builder.Services.AddHostedService<ConceptCleanupWorker>();
    builder.Services.AddHostedService<BackupWorker>();
    builder.Services.AddHostedService<LibraryReceiptRetentionWorker>();
}

var app = builder.Build();

// --- DATABASE BOOTSTRAP / MIGRATION ---
// A truly empty SQLite database (brand-new or zero tables) is bootstrapped
// to the complete current schema with an accurate EF migration-history
// baseline, in one transaction (see DatabaseBootstrapService). Any existing
// database goes through the ordinary EF migration path and is never
// rebaselined; a partial or unknown schema fails closed here.
if (deployment.Mode == DeploymentMode.SelfHosted)
{
    using var scope = app.Services.CreateScope();
    var bootstrap = scope.ServiceProvider.GetRequiredService<IDatabaseBootstrapService>();
    await bootstrap.EnsureReadyAsync();
}
else
{
    var controlPlaneBootstrap =
        app.Services.GetRequiredService<Nostos.Backend.Cloud.ControlPlane.ICloudControlPlaneBootstrapper>();
    await controlPlaneBootstrap.EnsureReadyAsync();

    // Prove the shared key ring can be decrypted before accepting traffic.
    // A replaced instance with the wrong master key therefore fails closed at
    // startup instead of invalidating sessions or encrypted settings later.
    app.Services
        .GetRequiredService<Nostos.Backend.Cloud.ControlPlane.CloudDataProtectionKeyRepository>()
        .EnsureReadable();

    var objectStorageBootstrap =
        app.Services.GetRequiredService<Nostos.Backend.Cloud.Storage.ICloudObjectStorageBootstrapper>();
    await objectStorageBootstrap.EnsureReadyAsync();
}

// ------------------------------------

// --- FORWARDED HEADERS (reverse proxy) ---
// First in the pipeline: everything downstream — static files, the SPA
// fallback, and above all the absolute URLs the OPDS feed builds — needs to see
// the scheme and host the client actually used, not the internal ones the proxy
// forwarded to. The trust list is left at its default (loopback only); see the
// registration above for why.
app.UseForwardedHeaders();

// --- OPDS EXPORT (access model) ---
// Stated in the operator's own logs, once, so that exposing the catalogue is a
// decision on the record rather than a silent consequence of mapping a route.
app.Logger.LogInformation(
    opdsOptions.Enabled
        ? deployment.Mode == DeploymentMode.Cloud
            ? "OPDS export enabled at /opds/ — page size {PageSize}, external base URL {PublicBaseUrl}. "
                + "Cloud authorization protects the catalogue; e-reader-specific Cloud access remains tracked separately."
            : "OPDS export enabled at /opds/ — page size {PageSize}, external base URL {PublicBaseUrl}. "
                + "It is UNAUTHENTICATED: keep Nostos on a private network (LAN/Tailscale) or set Opds:Enabled=false."
        : "OPDS export disabled (Opds:Enabled=false): /opds/ is not mapped.",
    opdsOptions.PageSize,
    opdsOptions.PublicBaseUrl ?? "derived from each request"
);

// --- GLOBAL ERROR HANDLING ---
app.UseExceptionHandler(exceptionApp =>
{
    exceptionApp.Run(async context =>
    {
        context.Response.ContentType = "application/problem+json";
        var exceptionFeature = context.Features.Get<IExceptionHandlerFeature>();
        var logger = context
            .RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GlobalExceptionHandler");

        var error = exceptionFeature?.Error;
        var statusCode = error is BadHttpRequestException badRequest
            ? badRequest.StatusCode
            : StatusCodes.Status500InternalServerError;

        if (error is not null && statusCode >= StatusCodes.Status500InternalServerError)
        {
            logger.LogError(
                error,
                "Unhandled exception on {Method} {Path}",
                context.Request.Method,
                context.Request.Path
            );
        }

        context.Response.StatusCode = statusCode;
        await Results.Problem(
            statusCode: statusCode,
            type: statusCode == StatusCodes.Status400BadRequest
                ? "https://tools.ietf.org/html/rfc9110#section-15.5.1"
                : "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            title: statusCode == StatusCodes.Status400BadRequest
                ? "The request could not be processed."
                : "An unexpected error occurred."
        ).ExecuteAsync(context);
    });
});

app.UseStatusCodePages();

// --- ROUTE & RESTORE MAINTENANCE GUARD ---
// Guards both the REST API surface and (when enabled) the MCP route. This
// middleware is registered before the MCP authentication gate, so
// maintenance stays authoritative: during a restore, MCP requests receive
// the existing 503 even with a valid bearer token.
app.Use(async (context, next) =>
{
    var mcpOptions = context.RequestServices.GetRequiredService<McpOptions>();
    var isApiPath = context.Request.Path.StartsWithSegments("/api");
    var isMcpPath = mcpOptions.Enabled && mcpOptions.Path.Length > 0 &&
                    context.Request.Path.StartsWithSegments(mcpOptions.Path);
    if (isApiPath || isMcpPath)
    {
        var settingsProvider = context.RequestServices.GetRequiredService<BackupSettingsProvider>();
        if (settingsProvider.IsInMaintenanceMode)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new { error = "Application is in maintenance mode during restore." });
            return;
        }
    }

    await next(context);
});

// --- MCP AUTHENTICATION GATE ---
// Registered after the maintenance guard (so maintenance cannot be bypassed
// by authenticating) and before static files and endpoint routing (so the
// configured MCP route cannot be reached without the exact bearer token).
// When MCP is disabled nothing is registered and the route stays unmapped.
if (mcpOptions.Enabled)
{
    app.UseMiddleware<McpAuthenticationMiddleware>(mcpApiKey);
}

// -----------------------------------

app.MapOpenApi();

// Cheap process liveness deliberately has no dependency checks. Readiness is
// separate and probes only the shared infrastructure required to serve real
// traffic; its response never includes connection strings, provider errors or
// customer identifiers.
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false,
    ResponseWriter = NostosHealthResponseWriter.WriteAsync,
}).AllowAnonymous();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains(NostosHealthCheckTags.Readiness),
    ResponseWriter = NostosHealthResponseWriter.WriteAsync,
}).AllowAnonymous();

// --- SERVE ANGULAR FRONTEND ---
app.UseDefaultFiles();
app.UseStaticFiles();

if (deployment.Mode == DeploymentMode.Cloud)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

// ------------------------------

// Map all endpoints
app.MapBooksEndpoints();
app.MapProviderEndpoints();
app.MapImportEndpoints();
app.MapNotesEndpoints();
app.MapNoteProcessingEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();
app.MapWritingsEndpoints();
app.MapTranscriptionEndpoints();
app.MapAssistantEndpoints();
app.MapAiProviderSettingsEndpoints();
app.MapAssistantSettingsEndpoints();
app.MapDeploymentCapabilitiesEndpoints();
app.MapPortabilityEndpoints();
if (deployment.Mode == DeploymentMode.Cloud)
{
    app.MapCloudAuthEndpoints();
    app.MapCloudProvisioningEndpoints();
    app.MapCloudRecoveryEndpoints();
    app.MapCloudBillingEndpoints();
    app.MapCloudManagedAiUsageEndpoints();
}
app.MapOpdsEndpoints(opdsOptions);
if (deployment.Mode == DeploymentMode.SelfHosted)
{
    app.MapBackupEndpoints();
}

// --- MCP STREAMABLE HTTP ENDPOINT ---
if (mcpOptions.Enabled)
{
    app.MapMcp(mcpOptions.Path);
}

// --- HANDLE ANGULAR ROUTING ---
// The SPA shell is served ONLY for client-side routes. The API, OPDS and MCP
// namespaces are never answered by index.html: unknown /api paths, wrong
// methods on API routes, and the MCP route family (the configured path
// when enabled, plus the conventional /mcp namespace in every
// configuration) resolve as ordinary 404/405 responses, so probes and
// misdirected clients never receive the Angular application shell. The
// fallback is deliberately method-constrained (GET/HEAD only), mirroring
// the static-file layer: every other verb on an unmapped path stays a 405
// instead of being answered with the shell.
//
// `/opds` is in that list for the same reason: an OPDS client pointed at a
// catalogue that is switched off (Opds:Enabled=false) must get a 404 it can
// report, not a page of HTML it cannot parse. This is what the frontend's
// ngsw `navigationUrls` already assumed about the backend.
RequestDelegate serveClientRoute = async context =>
{
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
        return;
    }

    var path = context.Request.Path;
    var isMcpPath = mcpOptions.Enabled && mcpOptions.Path.Length > 0 &&
                    path.StartsWithSegments(mcpOptions.Path);
    if (path.StartsWithSegments("/api") || path.StartsWithSegments("/opds") ||
        path.StartsWithSegments("/mcp") || isMcpPath)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var indexHtml = Path.Combine(app.Environment.WebRootPath, "index.html");
    if (!File.Exists(indexHtml))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html";
    await context.Response.SendFileAsync(indexHtml);
};

// The fallback endpoint carries the same GET/HEAD method constraint as the
// static-file layer: the routing method matcher keeps answering every other
// verb on unmapped paths with 405 before this delegate ever runs, so mapped
// POST routes are never shadowed.
app.MapFallback(serveClientRoute)
    .WithMetadata(new HttpMethodMetadata(new[] { "GET", "HEAD" }))
    .AllowAnonymous();

app.Run();
return 0;

public partial class Program;
