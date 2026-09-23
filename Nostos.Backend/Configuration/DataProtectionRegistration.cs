using Microsoft.AspNetCore.DataProtection;

namespace Nostos.Backend.Configuration;

public static class DataProtectionRegistration
{
    public static IServiceCollection AddNostosSelfHostedDataProtection(
        this IServiceCollection services)
    {
        services.AddDataProtection();
        return services;
    }
}
