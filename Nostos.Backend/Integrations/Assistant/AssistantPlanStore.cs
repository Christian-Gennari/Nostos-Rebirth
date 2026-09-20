using System.Security.Cryptography;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>One ordered step of a pending plan, exactly as it will be executed.</summary>
public sealed record AssistantPlanStep(string Capability, string Summary, string ArgumentsJson);

/// <summary>
/// A server-held pending plan. The approval token is bound to this plan id and
/// to nothing else.
/// </summary>
public sealed record StoredAssistantPlan(
    string PlanId,
    string ApprovalToken,
    string ConversationKey,
    string IdempotencyKey,
    string Summary,
    IReadOnlyList<AssistantPlanStep> Steps);

/// <summary>Outcome of an approval attempt; a refusal carries a typed code.</summary>
public sealed record AssistantPlanApprovalResult(
    bool Approved,
    StoredAssistantPlan? Plan,
    string? ErrorCode,
    string? ErrorMessage);

/// <summary>
/// Pending plans and their approval tokens (issue #261 §7).
///
/// IN-MEMORY BY DESIGN: this milestone has no persistence requirement for a plan
/// that is expected to live for one conversational exchange, and a restart
/// simply means the user asks again. It is a singleton, and the whole store is
/// replaced, never appended to: <see cref="Create"/> supersedes the single
/// pending plan for a conversation, which is what makes a stale plan id
/// unapprovable.
///
/// The guard is the point. Approving requires the exact current plan id for the
/// conversation AND its token; a missing token, an unknown id, a superseded id,
/// or a mismatched token is refused before any capability is reached, so a
/// refused approval mutates nothing.
/// </summary>
public sealed class AssistantPlanStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, StoredAssistantPlan> _byConversation = new(StringComparer.Ordinal);
    private readonly Dictionary<string, StoredAssistantPlan> _byPlanId = new(StringComparer.Ordinal);

    /// <summary>
    /// Stores a newly proposed plan and supersedes the conversation's previous
    /// pending plan, if any. The previous plan id immediately stops being
    /// approvable.
    /// </summary>
    public StoredAssistantPlan Create(
        string conversationKey,
        string idempotencyKey,
        string summary,
        IReadOnlyList<AssistantPlanStep> steps)
    {
        lock (_gate)
        {
            if (_byConversation.TryGetValue(conversationKey, out var previous))
            {
                _byPlanId.Remove(previous.PlanId);
            }

            var plan = new StoredAssistantPlan(
                PlanId: Guid.NewGuid().ToString("N"),
                ApprovalToken: Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
                ConversationKey: conversationKey,
                IdempotencyKey: idempotencyKey,
                Summary: summary,
                Steps: steps);

            _byConversation[conversationKey] = plan;
            _byPlanId[plan.PlanId] = plan;
            return plan;
        }
    }

    /// <summary>The conversation's single pending plan, if one exists.</summary>
    public StoredAssistantPlan? GetCurrent(string conversationKey)
    {
        lock (_gate)
        {
            return _byConversation.TryGetValue(conversationKey, out var plan) ? plan : null;
        }
    }

    /// <summary>
    /// Validates and consumes an approval. On success the plan is removed, so it
    /// can be executed exactly once. On refusal nothing is removed.
    /// </summary>
    public AssistantPlanApprovalResult Approve(string? planId, string? approvalToken)
    {
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(planId))
            {
                return Refuse(
                    AssistantErrorCodes.ApprovalRequired,
                    "A plan id is required to approve a plan.");
            }

            if (string.IsNullOrWhiteSpace(approvalToken))
            {
                return Refuse(
                    AssistantErrorCodes.ApprovalRequired,
                    $"Approving plan '{planId}' requires its approval token.");
            }

            if (!_byPlanId.TryGetValue(planId, out var plan))
            {
                return Refuse(
                    AssistantErrorCodes.NotFound,
                    $"No pending plan with id '{planId}' exists. It may have been approved already or superseded.");
            }

            // The plan must still be the conversation's single pending plan. A
            // superseded plan is deliberately not approvable even with its own
            // (now stale) token.
            if (!_byConversation.TryGetValue(plan.ConversationKey, out var current)
                || !ReferenceEquals(current, plan))
            {
                return Refuse(
                    AssistantErrorCodes.ApprovalPlanMismatch,
                    $"Plan '{planId}' is no longer the pending plan for this conversation.");
            }

            if (!FixedTimeEquals(plan.ApprovalToken, approvalToken))
            {
                return Refuse(
                    AssistantErrorCodes.ApprovalPlanMismatch,
                    $"The approval token does not match plan '{planId}'.");
            }

            // Consume before returning: one approval executes the plan once.
            _byConversation.Remove(plan.ConversationKey);
            _byPlanId.Remove(plan.PlanId);
            return new AssistantPlanApprovalResult(true, plan, null, null);
        }
    }

    private static bool FixedTimeEquals(string expected, string actual)
    {
        var expectedBytes = System.Text.Encoding.UTF8.GetBytes(expected);
        var actualBytes = System.Text.Encoding.UTF8.GetBytes(actual);
        return CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes);
    }

    private static AssistantPlanApprovalResult Refuse(string code, string message) =>
        new(false, null, code, message);
}
