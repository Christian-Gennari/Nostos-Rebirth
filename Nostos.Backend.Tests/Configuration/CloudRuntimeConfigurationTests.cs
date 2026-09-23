using FluentAssertions;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Configuration;
using Nostos.Backend.Health;
using Xunit;

namespace Nostos.Backend.Tests.Configuration;

public sealed class CloudRuntimeConfigurationTests
{
    [Fact]
    public void Cloud_Data_Protection_requires_external_wrapping_secret()
    {
        var services = new ServiceCollection();

        var act = () => services.AddNostosCloudDataProtection(
            new ConfigurationBuilder().Build(),
            _ => null);

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*NOSTOS_CLOUD_DATA_PROTECTION_KEY*");
    }

    [Fact]
    public void Cloud_Data_Protection_rejects_wrong_sized_wrapping_secret()
    {
        var services = new ServiceCollection();

        var act = () => services.AddNostosCloudDataProtection(
            new ConfigurationBuilder().Build(),
            _ => Convert.ToBase64String(new byte[16]));

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*exactly 32 bytes*");
    }

    [Fact]
    public void SelfHosted_Data_Protection_starts_without_Cloud_secrets()
    {
        var services = new ServiceCollection();

        var act = () => services.AddNostosSelfHostedDataProtection();

        act.Should().NotThrow();
        services.Should().NotContain(x =>
            x.ServiceType == typeof(CloudDataProtectionKeyRepository));
    }

    [Fact]
    public void Cloud_Data_Protection_uses_external_XML_repository()
    {
        var services = new ServiceCollection();

        services.AddNostosCloudDataProtection(
            new ConfigurationBuilder().Build(),
            _ => Convert.ToBase64String(new byte[32]));

        services.Should().Contain(x =>
            x.ServiceType == typeof(IXmlRepository)
            && x.ImplementationFactory != null);
        services.Should().Contain(x =>
            x.ServiceType == typeof(CloudDataProtectionKeyRepository));
    }

    [Theory]
    [InlineData(DeploymentMode.SelfHosted, "sqlite")]
    [InlineData(DeploymentMode.Cloud, "control-plane")]
    public void Readiness_registration_is_mode_specific(
        DeploymentMode mode,
        string expectedName)
    {
        var services = new ServiceCollection();
        if (mode == DeploymentMode.Cloud)
            services.AddNostosCloudHealthChecks();
        else
            services.AddNostosSelfHostedHealthChecks();

        using var provider = services.BuildServiceProvider();
        var options = provider
            .GetRequiredService<IOptions<HealthCheckServiceOptions>>()
            .Value;

        options.Registrations.Should().Contain(x =>
            x.Name == expectedName
            && x.Tags.Contains(NostosHealthCheckTags.Readiness));

        if (mode == DeploymentMode.Cloud)
        {
            options.Registrations.Should().Contain(x =>
                x.Name == "object-storage"
                && x.Tags.Contains(NostosHealthCheckTags.Readiness));
            options.Registrations.Should().NotContain(x => x.Name == "sqlite");
        }
        else
        {
            options.Registrations.Should().NotContain(x => x.Name == "control-plane");
            options.Registrations.Should().NotContain(x => x.Name == "object-storage");
        }
    }
}
