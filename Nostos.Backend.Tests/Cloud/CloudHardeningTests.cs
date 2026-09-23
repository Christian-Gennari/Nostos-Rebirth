using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Nostos.Backend.Cloud;
using Nostos.Backend.Configuration;
using Nostos.Backend.Endpoints;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudHardeningTests
{
    [Fact]
    public void SelfHosted_registers_no_cloud_request_hardening_infrastructure()
    {
        var services = new ServiceCollection();

        services.AddNostosCloudRequestHardening(
            DeploymentDescriptor.For(DeploymentMode.SelfHosted));

        services.Should().BeEmpty();
    }

    [Fact]
    public void Cloud_registers_request_hardening_infrastructure()
    {
        var services = new ServiceCollection();

        services.AddNostosCloudRequestHardening(
            DeploymentDescriptor.For(DeploymentMode.Cloud));

        services.Should().NotBeEmpty();
    }

    [Fact]
    public void Customer_database_connection_strings_are_pool_bounded_per_tenant()
    {
        var connections = new CloudDatabaseConnections(
            ControlPlane: "Host=localhost;Database=control;Username=control",
            Admin: "Host=localhost;Database=postgres;Username=admin",
            CustomerBase: "Host=localhost;Username=nostos_app;Maximum Pool Size=100");

        var factory = new CloudCustomerConnectionFactory(
            connections,
            new CloudControlPlaneOptions { CustomerMaxPoolSize = 5 });

        var parsed = new NpgsqlConnectionStringBuilder(
            factory.ForDatabase("nostos_u_test"));

        parsed.Database.Should().Be("nostos_u_test");
        parsed.MinPoolSize.Should().Be(0);
        parsed.MaxPoolSize.Should().Be(5);
    }

    [Fact]
    public void Provisioning_http_shape_does_not_expose_resource_or_schema_internals()
    {
        var json = JsonSerializer.Serialize(CloudProvisioningResponse.NotStarted);

        json.Should().Contain("State");
        json.Should().Contain("AccountState");
        json.Should().Contain("Ready");
        json.Should().Contain("Retryable");
        json.Should().NotContain("SchemaVersion");
        json.Should().NotContain("FailureCode");
        json.Should().NotContain("DatabaseName");
        json.Should().NotContain("StorageNamespace");
    }
}
