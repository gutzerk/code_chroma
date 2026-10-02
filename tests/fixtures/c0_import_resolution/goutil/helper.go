// Package goutil provides a small exported helper resolved cross-package.
package goutil

// Helper returns a greeting for name.
func Helper(name string) string {
	return "hello " + name
}
