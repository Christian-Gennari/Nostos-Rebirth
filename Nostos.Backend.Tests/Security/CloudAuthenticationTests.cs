using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Configuration;
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

    private sealed class FixedAccountStatusStore(CloudAccountStatus status) : ICloudAccountStatusStore
    {
        public ValueTask<CloudAccountStatus> GetStatusAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken) =>
            ValueTask.FromResult(status);
    }
}
