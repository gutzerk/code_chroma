// Package billing generates billing reports.
package billing

// Report holds a rendered billing summary.
type Report struct {
	Total int
}

// RenderReport builds a human-readable summary for an account.
func RenderReport(total int) string {
	return "total"
}

// formatCurrency is an internal helper with no exported doc requirement.
func formatCurrency(total int) string {
	return "currency"
}

func SendReport(total int) string {
	return "sent"
}
