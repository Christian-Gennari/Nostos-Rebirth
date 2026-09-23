using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Nostos.Backend.Configuration;
using Nostos.Backend.Cloud.Entitlements;

namespace Nostos.Backend.Security;

public static class CloudAuthSchemes
{
    public const string Router = "NostosCloud";
    public const string Cookie = "NostosCloudCookie";
    public const string Oidc = "NostosCloudOidc";
    public const string Bearer = "NostosCloudBearer";
}

public static class CloudAuthPolicies
{
    /// <summary>
    /// Valid Cloud identity without requiring the account to be provisioned
    /// and Active yet. Used only for provisioning/onboarding surfaces.
    /// </summary>
    public const string AuthenticatedAccount = "NostosCloudAuthenticatedAccount";

    /// <summary>
    /// Valid Cloud identity with effective Cloud access, without requiring
    /// provisioning to have reached Active yet.
    /// </summary>
    public const string EntitledAccount = "NostosCloudEntitledAccount";
}

public sealed class ActiveCloudAccountRequirement : IAuthorizationRequirement;

public sealed class CloudAccessRequirement : IAuthorizationRequirement;

public sealed class CloudAccessHandler(
    ICloudEntitlementService entitlements) : AuthorizationHandler<CloudAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        CloudAccessRequirement requirement)
    {
        var snapshot = await entitlements.GetEntitlementsAsync(CancellationToken.None);
        if (snapshot.CloudAccess)
            context.Succeed(requirement);
    }
}

public sealed class ActiveCloudAccountHandler(
    ICloudAccountContextResolver accountResolver,
    ICloudAccountStatusStore statusStore) : AuthorizationHandler<ActiveCloudAccountRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        ActiveCloudAccountRequirement requirement)
    {
        if (!accountResolver.TryResolve(context.User, out var account) || account is null)
            return;

        var status = await statusStore.GetStatusAsync(account.AccountId, CancellationToken.None);
        if (status == CloudAccountStatus.Active)
            context.Succeed(requirement);
    }
}

public static class CloudAuthenticationRegistration
{
    public static CloudAuthOptions? AddNostosAuthentication(
        this IServiceCollection services,
        IConfiguration configuration,
        DeploymentDescriptor deployment,
        Func<string, string?>? environmentReader = null)
    {
        if (deployment.Mode == DeploymentMode.SelfHosted)
            return null;

        var options = CloudAuthOptions.FromConfiguration(configuration);
        environmentReader ??= Environment.GetEnvironmentVariable;

        var clientSecret = environmentReader(options.ClientSecretEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(clientSecret))
        {
            throw new InvalidOperationException(
                $"Nostos Cloud authentication requires environment variable '{options.ClientSecretEnvironmentVariable}' to contain the OIDC client secret.");
        }

        services.AddSingleton(options);
        services.AddHttpContextAccessor();
        services.AddSingleton<ICloudAccountContextResolver, CloudAccountContextResolver>();
        services.AddSingleton<CloudBackgroundTenantContextAccessor>();
        services.AddScoped<CloudTenantContextScope>();
        services.AddScoped<ICloudTenantContextAccessor, HttpCloudTenantContextAccessor>();

        services.TryAddSingleton<ICloudAccountStatusStore, UnconfiguredCloudAccountStatusStore>();
        services.AddSingleton<IAuthorizationHandler, ActiveCloudAccountHandler>();
        services.AddScoped<IAuthorizationHandler, CloudAccessHandler>();

        services
            .AddAuthentication(authentication =>
            {
                authentication.DefaultScheme = CloudAuthSchemes.Router;
                authentication.DefaultAuthenticateScheme = CloudAuthSchemes.Router;
                authentication.DefaultChallengeScheme = CloudAuthSchemes.Router;
            })
            .AddPolicyScheme(
                CloudAuthSchemes.Router,
                displayName: null,
                policy =>
                {
                    policy.ForwardDefaultSelector = context =>
                    {
                        var authorization = context.Request.Headers.Authorization.ToString();
                        return authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                            ? CloudAuthSchemes.Bearer
                            : CloudAuthSchemes.Cookie;
                    };
                })
            .AddCookie(
                CloudAuthSchemes.Cookie,
                cookie =>
                {
                    cookie.Cookie.Name = "__Host-nostos-cloud";
                    cookie.Cookie.HttpOnly = true;
                    cookie.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                    cookie.Cookie.SameSite = SameSiteMode.Lax;
                    cookie.Cookie.Path = "/";
                    cookie.ExpireTimeSpan = TimeSpan.FromHours(options.SessionHours);
                    cookie.SlidingExpiration = false;

                    cookie.Events.OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    };
                    cookie.Events.OnRedirectToAccessDenied = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        return Task.CompletedTask;
                    };
                })
            .AddOpenIdConnect(
                CloudAuthSchemes.Oidc,
                oidc =>
                {
                    oidc.SignInScheme = CloudAuthSchemes.Cookie;
                    oidc.Authority = options.Authority;
                    oidc.ClientId = options.ClientId;
                    oidc.ClientSecret = clientSecret.Trim();
                    oidc.ResponseType = OpenIdConnectResponseType.Code;
                    oidc.UsePkce = true;
                    oidc.SaveTokens = false;
                    oidc.GetClaimsFromUserInfoEndpoint = false;
                    oidc.MapInboundClaims = false;
                    oidc.RequireHttpsMetadata = true;

                    oidc.Scope.Clear();
                    oidc.Scope.Add("openid");
                    oidc.Scope.Add("profile");
                    oidc.Scope.Add("email");

                    oidc.TokenValidationParameters.NameClaimType = "name";
                    oidc.Events.OnTokenValidated = context =>
                    {
                        StampValidatedIssuer(context.Principal, context.SecurityToken?.Issuer);
                        return Task.CompletedTask;
                    };
                })
            .AddJwtBearer(
                CloudAuthSchemes.Bearer,
                bearer =>
                {
                    bearer.Authority = options.Authority;
                    bearer.Audience = options.Audience;
                    bearer.RequireHttpsMetadata = true;
                    bearer.MapInboundClaims = false;
                    bearer.Events = new JwtBearerEvents
                    {
                        OnTokenValidated = context =>
                        {
                            StampValidatedIssuer(context.Principal, context.SecurityToken?.Issuer);
                            return Task.CompletedTask;
                        },
                    };
                });

        services
            .AddAuthorizationBuilder()
            .AddPolicy(
                CloudAuthPolicies.AuthenticatedAccount,
                new AuthorizationPolicyBuilder(CloudAuthSchemes.Router)
                    .RequireAuthenticatedUser()
                    .Build())
            .AddPolicy(
                CloudAuthPolicies.EntitledAccount,
                new AuthorizationPolicyBuilder(CloudAuthSchemes.Router)
                    .RequireAuthenticatedUser()
                    .AddRequirements(new CloudAccessRequirement())
                    .Build())
            .SetFallbackPolicy(
                new AuthorizationPolicyBuilder(CloudAuthSchemes.Router)
                    .RequireAuthenticatedUser()
                    .AddRequirements(
                        new ActiveCloudAccountRequirement(),
                        new CloudAccessRequirement())
                    .Build());

        return options;
    }

    private static void StampValidatedIssuer(ClaimsPrincipal? principal, string? issuer)
    {
        if (principal?.Identity is not ClaimsIdentity identity || string.IsNullOrWhiteSpace(issuer))
            return;

        var existing = identity.FindFirst(NostosCloudClaimTypes.ValidatedIssuer);
        if (existing is not null)
            identity.RemoveClaim(existing);

        identity.AddClaim(new Claim(NostosCloudClaimTypes.ValidatedIssuer, issuer));
    }
}
