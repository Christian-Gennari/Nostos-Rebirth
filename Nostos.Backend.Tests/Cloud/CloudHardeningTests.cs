using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
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
