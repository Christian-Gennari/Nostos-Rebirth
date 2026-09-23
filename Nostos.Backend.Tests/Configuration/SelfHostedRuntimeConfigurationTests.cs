using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Nostos.Backend.Configuration;
using Nostos.Backend.Health;
using Xunit;

namespace Nostos.Backend.Tests.Configuration;

public sealed class SelfHostedRuntimeConfigurationTests
{
    [Fact]
    public void SelfHosted_Data_Protection_starts_without_hosted_secrets()
    {
        var services = new ServiceCollection();

        var act = () => services.AddNostosSelfHostedDataProtection();

        act.Should().NotThrow();
    }

    [Fact]
    public void Readiness_contains_local_sqlite_and_no_hosted_services()
    {
        var services = new ServiceCollection();
        services.AddNostosSelfHostedHealthChecks();

        using var provider = services.BuildServiceProvider();
        var registrations = provider
            .GetRequiredService<IOptions<HealthCheckServiceOptions>>()
            .Value.Registrations;

        registrations.Should().Contain(registration =>
            registration.Name == "sqlite"
            && registration.Tags.Contains(NostosHealthCheckTags.Readiness));
        registrations.Should().NotContain(registration =>
            registration.Name == "control-plane" || registration.Name == "object-storage");
    }
}
