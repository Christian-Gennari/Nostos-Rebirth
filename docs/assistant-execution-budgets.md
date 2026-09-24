# Ask Nostos per-turn execution limits

Ask Nostos bounds each interactive turn independently of any host access or usage policy. The call, token, and elapsed-time limits protect SelfHosted BYOK deployments from runaway tool loops and stalled provider requests.

| Limit | Default | Purpose |
| --- | ---: | --- |
| Provider calls | 6 | Final runaway ceiling; repeated equivalent tool batches and approval/input boundaries stop earlier. |
| Cumulative reported tokens | 50,000 | Bounds one turn when the provider reports token usage. Unknown usage stays unknown and does not count as zero. |
| Elapsed time | 60,000 ms | Cancels an in-flight provider request at the remaining turn deadline. |

The limits were chosen after exercising representative library, notes, capture, approval, and required-input workflows. Across the nine deterministic product scenarios, turns used 1, 2, 2, 2, 3, 3, 4, 1, and 1 provider calls after the policy change. The largest legitimate scenario used four calls; a six-call ceiling remains available for future workflows and is the last safety bound.

A separate provider run recorded 900 turns. It found a 31,875-token maximum and eight calls that stalled for 141–145 seconds. Those observations supported the token and time headroom. They describe that test provider and transport only; BYOK provider prices and token accounting vary, so Nostos does not estimate customer spend in the public product.

On reaching a limit, Ask Nostos returns the completed work it can identify and explains that the turn stopped before finishing. Approval and user-input prompts keep their own result types. Missing token usage is never reported as zero, and no prompt, reply, tool arguments, tool results, or library content are stored in the execution metrics.

Provider-specific usage reporting and any commercial allowance policy belong to the host. The public SelfHosted host uses BYOK credentials and has no Nostos subscription or metering requirement.
