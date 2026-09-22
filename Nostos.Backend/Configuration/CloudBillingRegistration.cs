using System.Net.Http.Headers;
using Nostos.Backend.Cloud.Billing;

namespace Nostos.Backend.Configuration;

public static class CloudBillingRegistration
{
    public static IServiceCollection AddNostosCloudBilling(
        this IServiceCollection services,
        IConfiguration configuration,
        Func<string, string?>? environmentReader = null)
    {
        var options = CloudBillingOptions.FromConfiguration(configuration);
        var secrets = options.Paddle.ResolveSecrets(environmentReader);

        services.AddSingleton(options);
        services.AddSingleton(secrets);
        services.AddSingleton<ICloudBillingStateStore, CloudBillingStateStore>();

        services.AddHttpClient<PaddleApiClient>(client =>
        {
            client.BaseAddress = options.Paddle.ApiBaseUri;
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", secrets.ApiKey);
            client.DefaultRequestHeaders.Add("Paddle-Version", "1");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(
                "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
        });

        services.AddScoped<PaddleBillingService>();
        services.AddScoped<ICloudBillingService>(
            sp => sp.GetRequiredService<PaddleBillingService>());
        services.AddScoped<ICloudBillingWebhookProcessor>(
            sp => sp.GetRequiredService<PaddleBillingService>());

        services.AddHostedService<PaddleBillingReconciliationWorker>();

        return services;
    }
}
