using System.Text.RegularExpressions;

namespace CodeChroma.Canvas.Highlighting;

public enum TokenKind { Plain, Keyword, String, Comment, Number }

public readonly record struct Token(TokenKind Kind, string Text);

/// <summary>
/// A small dependency-free tokenizer for the code popup (replaces the Prism wrappers): strings, comments, numbers and
/// per-language keywords. Whatever the language, the tokens always concatenate back to the exact source.
/// </summary>
public static class SyntaxHighlighter
{
    private static readonly Dictionary<string, string[]> Keywords = new()
    {
        ["python"] = Split("def class return if elif else for while import from as with try except finally raise yield lambda pass break continue and or not in is None True False async await global nonlocal"),
        ["go"] = Split("func package import return if else for range switch case default struct interface type var const go defer chan map select break continue nil true false"),
        ["java"] = Split("public private protected class interface extends implements static final void int long double boolean new return if else for while switch case try catch finally throw throws import package this super null true false"),
        ["typescript"] = Split("function const let var return if else for while switch case default class interface type extends implements import export from as new this async await try catch finally throw null undefined true false"),
        ["csharp"] = Split("public private protected internal class interface struct enum record static readonly void int long double bool string var new return if else for foreach while switch case try catch finally throw using namespace this base null true false async await"),
        ["rust"] = Split("fn let mut pub struct enum impl trait use mod return if else for while loop match as self Self crate const static true false"),
        ["ruby"] = Split("def end class module return if elsif else unless while do begin rescue ensure yield nil true false self require"),
        ["swift"] = Split("func let var class struct enum protocol extension import return if else for while switch case guard self nil true false"),
        ["kotlin"] = Split("fun val var class object interface return if else for while when import package this null true false"),
        ["c"] = Split("int char void long short float double unsigned struct enum typedef static const return if else for while switch case break continue sizeof NULL"),
        ["bash"] = Split("if then else elif fi for while do done case esac function in echo export local return"),
        ["sql"] = Split("select from where insert into update delete create table join on group by order having limit and or not null as values set"),
        ["yaml"] = Split("true false null"),
        ["json"] = Split("true false null"),
        ["toml"] = Split("true false"),
        ["css"] = Split("important"),
    };

    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["javascript"] = "typescript", ["jsx"] = "typescript", ["tsx"] = "typescript", ["cpp"] = "c",
    };

    private static readonly HashSet<string> HashComment = ["python", "ruby", "bash", "yaml", "toml"];
    private static readonly HashSet<string> DashComment = ["sql"];
    private static readonly HashSet<string> SlashComment = ["go", "java", "typescript", "javascript", "jsx", "tsx", "csharp", "rust", "swift", "kotlin", "c", "cpp", "json", "css"];

    private static readonly Regex Number = new(@"\G\d[\d_]*(\.\d+)?([eE][+-]?\d+)?", RegexOptions.Compiled);
    private static readonly Regex Word = new(@"\G[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

    private static string[] Split(string words) => words.Split(' ');

    public static IReadOnlyList<Token> Tokenize(string? language, string source)
    {
        var canonical = LanguageRegistry.Resolve(language);
        var keywords = new HashSet<string>(Keywords.GetValueOrDefault(Aliases.GetValueOrDefault(canonical, canonical)) ?? [],
            canonical == "sql" ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        var tokens = new List<Token>();
        var plain = new System.Text.StringBuilder();
        void Flush() { if (plain.Length > 0) { tokens.Add(new Token(TokenKind.Plain, plain.ToString())); plain.Clear(); } }
        void Emit(TokenKind kind, string text) { Flush(); tokens.Add(new Token(kind, text)); }

        var i = 0;
        while (i < source.Length)
        {
            var c = source[i];
            if (canonical != LanguageRegistry.PlainText && StartsComment(canonical, source, i, out var blockEnd))
            {
                var end = blockEnd ?? LineEnd(source, i);
                Emit(TokenKind.Comment, source[i..end]);
                i = end;
            }
            else if (canonical != LanguageRegistry.PlainText && (c == '"' || c == '\'' || (c == '`' && canonical != "python")))
            {
                var end = StringEnd(source, i);
                Emit(TokenKind.String, source[i..end]);
                i = end;
            }
            else if (canonical != LanguageRegistry.PlainText && char.IsDigit(c) && (i == 0 || !(char.IsLetterOrDigit(source[i - 1]) || source[i - 1] == '_')))
            {
                var m = Number.Match(source, i);
                Emit(TokenKind.Number, m.Value);
                i += m.Length;
            }
            else if (char.IsLetter(c) || c == '_')
            {
                var m = Word.Match(source, i);
                var text = m.Success ? m.Value : c.ToString();
                if (keywords.Contains(text)) Emit(TokenKind.Keyword, text);
                else plain.Append(text);
                i += text.Length;
            }
            else
            {
                plain.Append(c);
                i++;
            }
        }
        Flush();
        return tokens;
    }

    private static bool StartsComment(string language, string s, int i, out int? blockEnd)
    {
        blockEnd = null;
        if (HashComment.Contains(language) && s[i] == '#') return true;
        if (DashComment.Contains(language) && s[i] == '-' && i + 1 < s.Length && s[i + 1] == '-') return true;
        if (!SlashComment.Contains(language) || s[i] != '/' || i + 1 >= s.Length) return false;
        if (s[i + 1] == '/') return true;
        if (s[i + 1] != '*') return false;
        var close = s.IndexOf("*/", i + 2, StringComparison.Ordinal);
        blockEnd = close < 0 ? s.Length : close + 2;
        return true;
    }

    private static int LineEnd(string s, int i)
    {
        var nl = s.IndexOf('\n', i);
        return nl < 0 ? s.Length : nl;
    }

    private static int StringEnd(string s, int start)
    {
        var quote = s[start];
        if (quote != '`' && start + 2 < s.Length && s[start + 1] == quote && s[start + 2] == quote)
        {
            var close = s.IndexOf(new string(quote, 3), start + 3, StringComparison.Ordinal);
            return close < 0 ? s.Length : close + 3;
        }
        for (var i = start + 1; i < s.Length; i++)
        {
            if (s[i] == '\\') { i++; continue; }
            if (s[i] == quote) return i + 1;
            if (s[i] == '\n' && quote != '`') return i;
        }
        return s.Length;
    }
}
