import Prism from "prismjs";
import "prismjs/components/prism-toml";
import { createPrismHighlighter } from "./prismAdapter";

export const tomlHighlighter = createPrismHighlighter("toml", Prism.languages.toml);
