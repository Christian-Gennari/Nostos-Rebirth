using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Nostos.Backend.Cloud.ControlPlane;

namespace Nostos.Backend.Configuration;

public static class DataProtectionRegistration
{
    public static IServiceCollection AddNostosDataProtection(
        this IServiceCollection services,
        IConfiguration configuration,
        DeploymentDescriptor deployment,
        Func<string, string?>? environmentReader = null)
    {
        if (deployment.Mode == DeploymentMode.SelfHosted)
        {
            services.AddDataProtection();
            return services;
        }

        var material = CloudDataProtectionOptions.Resolve(configuration, environmentReader);
        services.AddSingleton(material.Options);
        services.AddSingleton(material);
        services.AddSingleton<CloudDataProtectionKeyRepository>();
        services.AddSingleton<IXmlRepository>(
            sp => sp.GetRequiredService<CloudDataProtectionKeyRepository>());

        services
            .AddDataProtection()
            .SetApplicationName("Nostos.Cloud.v1");

        services
            .AddOptions<KeyManagementOptions>()
            .Configure<IXmlRepository>((options, repository) =>
                options.XmlRepository = repository);

        return services;
    }
}
