using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Nostos.Backend.Configuration;
using Nostos.Backend.Endpoints;
using Xunit;

namespace Nostos.Backend.Tests.Security;

public sealed class CloudOpdsSecurityTests
{
    [Fact]
    public async Task Opds_routes_do_not_bypass_cloud_fallback_authorization()
    {
        var builder = WebApplication.CreateBuilder();
        var app = builder.Build();

        app.MapOpdsEndpoints(new OpdsOptions { Enabled = true });

        var endpoints = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint =>
                endpoint.RoutePattern.RawText is "/opds/" or "/api/opds/info")
            .ToList();

        endpoints.Should().HaveCount(2);
        endpoints.Should().OnlyContain(endpoint =>
            endpoint.Metadata.GetMetadata<IAllowAnonymous>() is null);

        await app.DisposeAsync();
    }
}
