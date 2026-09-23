using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Endpoints;
using Xunit;

namespace Nostos.Backend.Tests.Security;

public sealed class CloudOpdsSecurityTests
{
    [Fact]
    public async Task Opds_routes_do_not_bypass_cloud_fallback_authorization()
    {
        var builder = WebApplication.CreateBuilder();
        // Endpoint metadata inference must know that IBookRepository is a DI
        // service; the test never executes the feed handler.
        builder.Services.AddSingleton<IBookRepository>(_ => null!);
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
            endpoint.Metadata.GetMetadata<IAllowAnonymous>() == null);

        await app.DisposeAsync();
    }
}
