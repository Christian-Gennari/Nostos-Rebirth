using Microsoft.AspNetCore.RateLimiting;
using Nostos.Backend.Security;
using System.Threading.RateLimiting;

namespace Nostos.Backend.Configuration;

public static class CloudRateLimitPolicies
{
    public const string Provisioning = "cloud-provisioning";
    public const string ExpensiveMutation = "cloud-expensive-mutation";
    public const string LargeTransfer = "cloud-large-transfer";
    public const string ProviderFetch = "cloud-provider-fetch";
    public const string Billing = "cloud-billing";
    public const string ProviderWebhook = "cloud-provider-webhook";
}

public static class CloudRequestHardeningRegistration
{
    public const long MaxCoverUploadBytes = 25L * 1024 * 1024;
    public const long MaxCoverRequestBytes = 26L * 1024 * 1024;
    public const long MaxProviderWebhookBytes = 1024 * 1024;

    public static IServiceCollection AddNostosCloudRequestHardening(
        this IServiceCollection services,
        DeploymentDescriptor deployment)
    {
        if (deployment.Mode != DeploymentMode.Cloud)
            return services;

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.AddPolicy(
                CloudRateLimitPolicies.Provisioning,
                context => FixedWindow(context, permitLimit: 4, TimeSpan.FromMinutes(1)));
            options.AddPolicy(
                CloudRateLimitPolicies.ExpensiveMutation,
                context => FixedWindow(context, permitLimit: 20, TimeSpan.FromMinutes(1)));
            options.AddPolicy(
                CloudRateLimitPolicies.LargeTransfer,
                context => FixedWindow(context, permitLimit: 4, TimeSpan.FromMinutes(10)));
            options.AddPolicy(
                CloudRateLimitPolicies.ProviderFetch,
                context => FixedWindow(context, permitLimit: 120, TimeSpan.FromMinutes(1)));
            options.AddPolicy(
                CloudRateLimitPolicies.Billing,
                context => FixedWindow(context, permitLimit: 12, TimeSpan.FromMinutes(1)));
            options.AddPolicy(
                CloudRateLimitPolicies.ProviderWebhook,
                _ => RateLimitPartition.GetFixedWindowLimiter(
                    "provider-webhook",
                    _ => Options(120, TimeSpan.FromMinutes(1))));
        });

        return services;
    }

    private static RateLimitPartition<string> FixedWindow(
        HttpContext context,
        int permitLimit,
        TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(
            AccountPartitionKey(context),
            _ => Options(permitLimit, window));

    private static FixedWindowRateLimiterOptions Options(int permitLimit, TimeSpan window) =>
        new()
        {
            PermitLimit = permitLimit,
            Window = window,
            QueueLimit = 0,
            AutoReplenishment = true,
        };

    private static string AccountPartitionKey(HttpContext context)
    {
        var resolver = context.RequestServices.GetService<ICloudAccountContextResolver>();
        if (resolver is not null
            && resolver.TryResolve(context.User, out var account)
            && account is not null)
        {
            return account.AccountId.ToString();
        }

        return "anonymous";
    }
}
