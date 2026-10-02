// Package goservice calls the goutil package across a real go.mod-rooted import path.
package goservice

import "example.com/c0fixture/goutil"

// Greet resolves through the imported package's directory, not a string comparison.
func Greet(name string) string {
	return goutil.Helper(name)
}
