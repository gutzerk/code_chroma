import { shouldWarnBilling } from "./billingWarning";
import type { Provider } from "./llmSettingsClient";

/** The one billing-warning line (FR-010/FR-011), shown wherever a non-local api provider is
 * picked or already assigned -- `provider` may be undefined (nothing selected yet). */
export function BillingWarningBadge({
  provider,
  testId,
}: {
  provider: Pick<Provider, "kind" | "is_local"> | undefined;
  testId: string;
}) {
  if (!provider || !shouldWarnBilling(provider)) return null;
  return (
    <span
      className="llm-billing-warning"
      data-testid={testId}
      title="Billed by the API, separate from any CLI subscription"
    >
      Billed per token
    </span>
  );
}
