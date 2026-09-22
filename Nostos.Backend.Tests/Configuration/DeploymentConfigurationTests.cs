using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Data;
using Nostos.Backend.Configuration;
using Nostos.Backend.Endpoints;
using Xunit;

namespace Nostos.Backend.Tests.Configuration;

public sealed class DeploymentConfigurationTests
{
    [Fact]
    public void Missing_configuration_defaults_to_self_hosted()
    {
        var configuration = new ConfigurationBuilder().Build();

        var deployment = DeploymentDescriptor.FromConfiguration(configuration);

        deployment.Mode.Should().Be(DeploymentMode.SelfHosted);
        deployment.Capabilities.Should().Be(new DeploymentCapabilities(
            RequiresAuthentication: false,
            CanConfigureAiProvider: true,
            ManagedAi: false,
            ManagedVoiceTranscription: false,
            UsesCloudStorage: false,
            SupportsLocalBackupConfiguration: true,
            UsageMeteringAvailable: false));
    }

    [Fact]
    public void Cloud_configuration_is_case_insensitive_and_has_cloud_contract()
    {
        var configuration = BuildConfiguration("cloud");

        var deployment = DeploymentDescriptor.FromConfiguration(configuration);

        deployment.Mode.Should().Be(DeploymentMode.Cloud);
        deployment.Capabilities.Should().Be(new DeploymentCapabilities(
            RequiresAuthentication: true,
            CanConfigureAiProvider: false,
            ManagedAi: true,
            ManagedVoiceTranscription: true,
            UsesCloudStorage: true,
            SupportsLocalBackupConfiguration: false,
            UsageMeteringAvailable: true));
    }

    [Fact]
    public void Invalid_mode_fails_with_actionable_configuration_error()
    {
        var configuration = BuildConfiguration("Hosted");

        var act = () => DeploymentDescriptor.FromConfiguration(configuration);

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*Nostos:DeploymentMode*Hosted*SelfHosted*Cloud*");
    }

    [Fact]
    public void Self_hosted_persistence_registration_remains_zero_cloud_dependency()
    {
        var services = new ServiceCollection();
        var deployment = DeploymentDescriptor.For(DeploymentMode.SelfHosted);

        var act = () => services.AddNostosPersistence(
            new ConfigurationBuilder().Build(),
            deployment,
            Path.Combine(Path.GetTempPath(), "nostos-deployment-test"));

        act.Should().NotThrow();
        services.Should().Contain(service =>
            service.ServiceType.Name.Contains("DbContextFactory", StringComparison.Ordinal));
        services.Should().NotContain(service =>
            service.ServiceType == typeof(ICloudEntitlementService));
        services.Should().NotContain(service =>
            service.ServiceType == typeof(ICloudBillingService));
        services.Should().NotContain(service =>
            service.ServiceType == typeof(ICloudBillingStateStore));
    }

    [Fact]
    public void Cloud_persistence_requires_server_side_postgresql_connections()
    {
        var services = new ServiceCollection();
        var deployment = DeploymentDescriptor.For(DeploymentMode.Cloud);

        var act = () => services.AddNostosPersistence(
            new ConfigurationBuilder().Build(),
            deployment,
            Path.GetTempPath(),
            _ => null);

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION*PostgreSQL connection string*");
    }

    [Fact]
    public void Cloud_persistence_registers_tenant_factory_without_connecting_during_composition()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddHttpContextAccessor();

        var deployment = DeploymentDescriptor.For(DeploymentMode.Cloud);
        var environment = new Dictionary<string, string>
        {
            ["NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION"] =
                "Host=localhost;Database=nostos_control;Username=nostos",
            ["NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION"] =
                "Host=localhost;Database=postgres;Username=admin",
            ["NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION"] =
                "Host=localhost;Username=nostos_app",
        };

        var act = () => services.AddNostosPersistence(
            new ConfigurationBuilder().Build(),
            deployment,
            Path.GetTempPath(),
            name => environment.GetValueOrDefault(name));

        act.Should().NotThrow();
        services.Should().Contain(service =>
            service.ServiceType == typeof(IDbContextFactory<NostosDbContext>));
        services.Should().Contain(service =>
            service.ServiceType.Name == "ICloudControlPlaneStore");
        services.Should().Contain(service =>
            service.ServiceType == typeof(ICloudEntitlementService));
    }

    [Fact]
    public void Capability_response_contains_only_product_runtime_contract()
    {
        var deployment = DeploymentDescriptor.For(DeploymentMode.Cloud);

        var response = DeploymentCapabilitiesEndpoints.ToResponse(deployment);

        response.DeploymentMode.Should().Be("Cloud");
        response.RequiresAuthentication.Should().BeTrue();
        response.CanConfigureAiProvider.Should().BeFalse();
        response.ManagedAi.Should().BeTrue();
        response.ManagedVoiceTranscription.Should().BeTrue();
        response.UsesCloudStorage.Should().BeTrue();
        response.SupportsLocalBackupConfiguration.Should().BeFalse();
        response.UsageMeteringAvailable.Should().BeTrue();
    }

    private static IConfiguration BuildConfiguration(string mode) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [DeploymentDescriptor.ConfigurationKey] = mode,
            })
            .Build();
}
