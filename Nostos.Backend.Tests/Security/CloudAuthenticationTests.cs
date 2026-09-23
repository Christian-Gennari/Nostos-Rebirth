using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Configuration;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Security;

public sealed class CloudAuthenticationTests
{
    [Fact]
    public void SelfHosted_does_not_require_or_register_cloud_authentication()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        var result = services.AddNostosAuthentication(
            configuration,
            DeploymentDescriptor.For(DeploymentMode.SelfHosted),
            _ => null);

        result.Should().BeNull();
        services.Should().NotContain(service => service.ServiceType == typeof(ICloudAccountContextResolver));
        services.Should().NotContain(service =>
            service.ServiceType == typeof(IAuthorizationHandler)
            && service.ImplementationType == typeof(CloudAccessHandler));
    }

    [Fact]
    public void Cloud_authentication_validates_configuration_and_resolves_secret_outside_configuration()
    {
        var services = new ServiceCollection();
        var configuration = BuildCloudConfiguration();

        var options = services.AddNostosAuthentication(
            configuration,
            DeploymentDescriptor.For(DeploymentMode.Cloud),
            variable => variable == "NOSTOS_TEST_OIDC_SECRET" ? "test-secret" : null);

        options.Should().NotBeNull();
        options!.Authority.Should().Be("https://identity.example.test");
        options.Audience.Should().Be("nostos-api");
        services.Should().Contain(service => service.ServiceType == typeof(ICloudAccountContextResolver));
        services.Should().Contain(service => service.ServiceType == typeof(ICloudTenantContextAccessor));
        services.Should().Contain(service => service.ServiceType == typeof(ICloudAccountStatusStore));
    }

    [Fact]
    public void Cloud_authentication_fails_closed_when_client_secret_is_missing()
    {
        var services = new ServiceCollection();
        var configuration = BuildCloudConfiguration();

        var act = () => services.AddNostosAuthentication(
            configuration,
            DeploymentDescriptor.For(DeploymentMode.Cloud),
            _ => null);

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*NOSTOS_TEST_OIDC_SECRET*OIDC client secret*");
    }

    [Fact]
    public void Canonical_account_id_uses_issuer_and_subject_not_email()
    {
        var resolver = new CloudAccountContextResolver();
        var first = Principal("https://identity.example.test", "subject-123", "first@example.test");
        var changedEmail = Principal("https://identity.example.test", "subject-123", "changed@example.test");
        var anotherSubject = Principal("https://identity.example.test", "subject-456", "first@example.test");

        resolver.TryResolve(first, out var firstAccount).Should().BeTrue();
        resolver.TryResolve(changedEmail, out var changedEmailAccount).Should().BeTrue();
        resolver.TryResolve(anotherSubject, out var anotherAccount).Should().BeTrue();

        firstAccount!.AccountId.Should().Be(changedEmailAccount!.AccountId);
        firstAccount.AccountId.Should().NotBe(anotherAccount!.AccountId);
        firstAccount.Email.Should().Be("first@example.test");
        changedEmailAccount.Email.Should().Be("changed@example.test");
    }

    [Fact]
    public void Tenant_context_comes_only_from_authenticated_claims_not_request_parameters()
    {
        var resolver = new CloudAccountContextResolver();
        var accountA = Principal("https://identity.example.test", "account-a", "a@example.test");
        var accountBId = NostosAccountId
            .FromExternalIdentity("https://identity.example.test", "account-b")
            .ToString();

        var httpContext = new DefaultHttpContext
        {
            User = accountA,
        };
        httpContext.Request.QueryString = new QueryString($"?accountId={accountBId}");
        httpContext.Request.Headers["X-Nostos-Account-Id"] = accountBId;

        var accessor = new HttpCloudTenantContextAccessor(
            new HttpContextAccessor { HttpContext = httpContext },
            resolver);

        var resolved = accessor.GetRequired();

        resolved.AccountId.Should().Be(
            NostosAccountId.FromExternalIdentity("https://identity.example.test", "account-a"));
        resolved.AccountId.ToString().Should().NotBe(accountBId);
    }

    [Theory]
    [InlineData(CloudAccountStatus.Active, true)]
    [InlineData(CloudAccountStatus.Unknown, false)]
    [InlineData(CloudAccountStatus.Disabled, false)]
    [InlineData(CloudAccountStatus.Deleted, false)]
    public async Task Protected_cloud_authorization_requires_active_server_side_account_status(
        CloudAccountStatus status,
        bool expectedSuccess)
    {
        var principal = Principal("https://identity.example.test", "account-a", "a@example.test");
        var requirement = new ActiveCloudAccountRequirement();
        var authorizationContext = new AuthorizationHandlerContext(
            new[] { requirement },
            principal,
            resource: null);

        var handler = new ActiveCloudAccountHandler(
            new CloudAccountContextResolver(),
            new FixedAccountStatusStore(status));

        await handler.HandleAsync(authorizationContext);

        authorizationContext.HasSucceeded.Should().Be(expectedSuccess);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task Cloud_access_authorization_uses_server_authoritative_entitlements(
        bool cloudAccess,
        bool expectedSuccess)
    {
        var requirement = new CloudAccessRequirement();
        var authorizationContext = new AuthorizationHandlerContext(
            new[] { requirement },
            Principal("https://identity.example.test", "account-a", "a@example.test"),
            resource: null);

        var handler = new CloudAccessHandler(
            new CloudAccountContextResolver(),
            new FixedEntitlementService(cloudAccess));

        await handler.HandleAsync(authorizationContext);

        authorizationContext.HasSucceeded.Should().Be(expectedSuccess);
    }

    [Fact]
    public async Task Anonymous_cloud_access_authorization_fails_without_resolving_entitlements()
    {
        var requirement = new CloudAccessRequirement();
        var authorizationContext = new AuthorizationHandlerContext(
            new[] { requirement },
            new ClaimsPrincipal(new ClaimsIdentity()),
            resource: null);

        var handler = new CloudAccessHandler(
            new CloudAccountContextResolver(),
            new ThrowingEntitlementService());

        var act = async () => await handler.HandleAsync(authorizationContext);

        await act.Should().NotThrowAsync();
        authorizationContext.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public void Cloud_authentication_options_pin_https_pkce_cookie_and_bearer_audience()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var configuration = BuildCloudConfiguration();

        services.AddNostosAuthentication(
            configuration,
            DeploymentDescriptor.For(DeploymentMode.Cloud),
            variable => variable == "NOSTOS_TEST_OIDC_SECRET" ? "test-secret" : null);

        using var provider = services.BuildServiceProvider();

        var oidc = provider
            .GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<OpenIdConnectOptions>>()
            .Get(CloudAuthSchemes.Oidc);
        oidc.Authority.Should().Be("https://identity.example.test");
        oidc.ClientId.Should().Be("nostos-web");
        oidc.ResponseType.Should().Be("code");
        oidc.UsePkce.Should().BeTrue();
        oidc.RequireHttpsMetadata.Should().BeTrue();
        oidc.SaveTokens.Should().BeFalse();
        oidc.MapInboundClaims.Should().BeFalse();

        var bearer = provider
            .GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<JwtBearerOptions>>()
            .Get(CloudAuthSchemes.Bearer);
        bearer.Authority.Should().Be("https://identity.example.test");
        bearer.Audience.Should().Be("nostos-api");
        bearer.RequireHttpsMetadata.Should().BeTrue();
        bearer.MapInboundClaims.Should().BeFalse();

        var cookie = provider
            .GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CloudAuthSchemes.Cookie);
        cookie.Cookie.Name.Should().Be("__Host-nostos-cloud");
        cookie.Cookie.HttpOnly.Should().BeTrue();
        cookie.Cookie.SecurePolicy.Should().Be(CookieSecurePolicy.Always);
        cookie.Cookie.SameSite.Should().Be(SameSiteMode.Lax);
        cookie.Cookie.Path.Should().Be("/");
    }

    [Fact]
    public void Cloud_oidc_logout_sends_client_id_when_tokens_are_not_saved()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var configuration = BuildCloudConfiguration();

        services.AddNostosAuthentication(
            configuration,
            DeploymentDescriptor.For(DeploymentMode.Cloud),
            variable => variable == "NOSTOS_TEST_OIDC_SECRET" ? "test-secret" : null);

        using var provider = services.BuildServiceProvider();
        var options = provider
            .GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<Microsoft.AspNetCore.Authentication.OpenIdConnect.OpenIdConnectOptions>>()
            .Get(CloudAuthSchemes.Oidc);

        options.Events.OnRedirectToIdentityProviderForSignOut.Should().NotBeNull();
    }

    [Fact]
    public async Task Session_response_exposes_safe_account_state_without_external_identity_keys()
    {
        var httpContext = new DefaultHttpContext
        {
            User = Principal("https://identity.example.test", "private-provider-subject", "reader@example.test"),
        };

        var response = await CloudAuthEndpoints.GetSessionAsync(
            httpContext,
            new CloudAccountContextResolver(),
            new FixedAccountStatusStore(CloudAccountStatus.Active),
            CancellationToken.None);

        response.Authenticated.Should().BeTrue();
        response.AccountState.Should().Be("Active");
        response.Account.Should().NotBeNull();
        response.Account!.Email.Should().Be("reader@example.test");
        response.Account.Id.Should().NotContain("private-provider-subject");
        response.Account.Id.Should().NotContain("identity.example.test");
    }

    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("https://evil.example/", "/")]
    [InlineData("//evil.example/", "/")]
    [InlineData("/\\\\evil.example/", "/")]
    [InlineData("/library", "/library")]
    [InlineData("/book/123?tab=notes#quote", "/book/123?tab=notes#quote")]
    public void Login_return_url_is_local_only(string? candidate, string expected)
    {
        CloudAuthEndpoints.NormalizeLocalReturnUrl(candidate).Should().Be(expected);
    }

    private static IConfiguration BuildCloudConfiguration() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CloudAuth:Authority"] = "https://identity.example.test/",
                ["CloudAuth:ClientId"] = "nostos-web",
                ["CloudAuth:Audience"] = "nostos-api",
                ["CloudAuth:ClientSecretEnvironmentVariable"] = "NOSTOS_TEST_OIDC_SECRET",
                ["CloudAuth:SessionHours"] = "12",
            })
            .Build();

    private static ClaimsPrincipal Principal(string issuer, string subject, string email)
    {
        var identity = new ClaimsIdentity(
            new[]
            {
                new Claim(NostosCloudClaimTypes.ValidatedIssuer, issuer),
                new Claim("iss", "https://untrusted-claim-value.invalid"),
                new Claim("sub", subject),
                new Claim("name", "Reader"),
                new Claim("email", email),
            },
            authenticationType: "test");

        return new ClaimsPrincipal(identity);
    }

    private sealed class ThrowingEntitlementService : ICloudEntitlementService
    {
        public Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException(
                "Entitlements must not be resolved for an anonymous principal.");
    }

    private sealed class FixedEntitlementService(bool cloudAccess) : ICloudEntitlementService
    {
        public Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudEntitlementSnapshot(
                CloudSubscriptionStatus.Active,
                CloudAccess: cloudAccess,
                ManagedAiEnabled: false,
                ManagedAiMonthlyAllowance: 0,
                StorageBytesLimit: 0));
    }

    private sealed class FixedAccountStatusStore(CloudAccountStatus status) : ICloudAccountStatusStore
    {
        public ValueTask<CloudAccountStatus> GetStatusAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken) =>
            ValueTask.FromResult(status);
    }
}
