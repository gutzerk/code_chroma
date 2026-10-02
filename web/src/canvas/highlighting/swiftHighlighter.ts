import Prism from "prismjs";
import "prismjs/components/prism-swift";
import { createPrismHighlighter } from "./prismAdapter";

export const swiftHighlighter = createPrismHighlighter("swift", Prism.languages.swift);
