using System.Text.Json;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// The only way an assistant capability runs. It is deliberately tiny: it looks
/// the capability up by name and enforces the D7 trust classes before the
/// capability's delegate is reached.
///
/// The guard is the point of this class. A <see cref="AssistantTrustClass.PlanAndAct"/>
/// capability is refused when the context carries no approval, and when the
/// approval's plan id does not match the plan the call was built against. Both
/// refusals are typed failure results returned before <c>Execute</c> runs, so a
/// refused call cannot have touched a store.
/// </summary>
public sealed class AssistantCapabilityRegistry
{
    private readonly IReadOnlyList<AssistantCapability> _all;
    private readonly Dictionary<string, AssistantCapability> _byName;

    public AssistantCapabilityRegistry(IEnumerable<AssistantCapability> capabilities)
    {
        // Reject a duplicate name at construction rather than letting one
        // capability silently shadow another.
        _all = capabilities.ToList();
        _byName = _all.ToDictionary(c => c.Name, StringComparer.Ordinal);
    }

    /// <summary>
    /// Ordered capability definitions, for tool-definition generation. The
    /// order is the order they were built in.
    /// </summary>
    public IReadOnlyList<AssistantCapability> All => _all;

    /// <summary>
    /// Invokes one capability by name. Returns a typed failure for an unknown
    /// name, a missing PlanAndAct approval, or an approval for a different
    /// plan; never throws for those cases.
    /// </summary>
    public async Task<AssistantToolResult> InvokeAsync(
        string name,
        JsonElement argsJson,
        AssistantToolContext context,
        CancellationToken ct = default)
    {
        if (!_byName.TryGetValue(name, out var capability))
        {
            return AssistantToolResult.Fail(
                AssistantErrorCodes.UnknownCapability,
                $"No assistant capability named '{name}' is registered.");
        }

        // The guard runs BEFORE Execute. A refused call therefore cannot have
        // reached the canonical service, and cannot have written anything.
        if (capability.Trust == AssistantTrustClass.PlanAndAct)
        {
            var refusal = CheckApproval(capability, context);
            if (refusal is not null)
            {
                return refusal;
            }
        }

        return await capability.Execute(context, argsJson, ct);
    }

    private static AssistantToolResult? CheckApproval(
        AssistantCapability capability,
        AssistantToolContext context)
    {
        if (context.Approval is null)
        {
            return AssistantToolResult.Fail(
                AssistantErrorCodes.ApprovalRequired,
                $"Capability '{capability.Name}' changes state and requires an approval " +
                $"for plan '{context.PlanId ?? "(none)"}'.");
        }

        if (string.IsNullOrWhiteSpace(context.PlanId)
            || !string.Equals(context.PlanId, context.Approval.PlanId, StringComparison.Ordinal))
        {
            return AssistantToolResult.Fail(
                AssistantErrorCodes.ApprovalPlanMismatch,
                $"Capability '{capability.Name}' was built against plan " +
                $"'{context.PlanId ?? "(none)"}' but the approval is for plan " +
                $"'{context.Approval.PlanId}'.");
        }

        return null;
    }
}
