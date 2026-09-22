using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Services;

namespace Nostos.Backend.Configuration;

public static class CloudObjectStorageRegistration
{
    public static IServiceCollection AddNostosCloudObjectStorage(
        this IServiceCollection services,
        IConfiguration configuration,
        Func<string, string?>? environmentReader = null)
    {
        var options = CloudObjectStorageOptions.FromConfiguration(configuration);
        var credentials = options.ResolveCredentials(environmentReader);

        services.AddSingleton(options);
        services.AddSingleton<IAmazonS3>(_ =>
        {
            var config = new AmazonS3Config
            {
                ForcePathStyle = options.ForcePathStyle,
            };

            if (options.ServiceUrl is not null)
            {
                config.ServiceURL = options.ServiceUrl;
                config.AuthenticationRegion = options.Region;
            }
            else
            {
                config.RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region);
            }

            return new AmazonS3Client(
                new BasicAWSCredentials(credentials.AccessKey, credentials.SecretKey),
                config);
        });

        services.AddScoped<IBookAssetStorage, S3BookAssetStorage>();
        services.AddSingleton<ICloudObjectStorageBootstrapper, CloudObjectStorageBootstrapper>();
        return services;
    }
}
