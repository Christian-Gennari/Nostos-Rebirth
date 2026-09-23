using FluentAssertions;
using Nostos.Backend.Data;
using Nostos.Product.Composition;

namespace Nostos.Backend.Tests.Architecture;

public sealed class ProductBoundaryTests
{
    [Fact]
    public void Canonical_product_types_are_owned_by_reusable_product_assembly()
    {
        typeof(NostosDbContext).Assembly.GetName().Name.Should().Be("Nostos.Product");
        typeof(NostosProductComposition).Assembly.Should().BeSameAs(typeof(NostosDbContext).Assembly);
    }

    [Fact]
    public void Product_assembly_does_not_reference_public_host_assembly()
    {
        var references = typeof(NostosProductComposition)
            .Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name)
            .ToList();

        references.Should().NotContain("Nostos.Backend");
    }

    [Fact]
    public void Product_assembly_contains_no_hosted_cloud_implementation_namespace()
    {
        var hostedTypes = typeof(NostosProductComposition)
            .Assembly
            .GetTypes()
            .Where(type =>
                type.Namespace?.StartsWith(
                    "Nostos.Backend.Cloud",
                    StringComparison.Ordinal) == true)
            .Select(type => type.FullName)
            .ToList();

        hostedTypes.Should().BeEmpty();
    }
}
