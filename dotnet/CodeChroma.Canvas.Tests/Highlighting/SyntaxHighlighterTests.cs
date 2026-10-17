namespace CodeChroma.Canvas.Tests.Highlighting;

/// <summary>Replaces the dropped Prism-output tests: kinds per language from a table, and the reassembly invariant everywhere.</summary>
public class SyntaxHighlighterTests
{
    public static IEnumerable<object[]> Kinds => Fx.Cases("syntax_tokens.json", "kinds");

    public static IEnumerable<object[]> Languages =>
        Fx.Load("highlighter_aliases.json").GetProperty("aliases").EnumerateArray()
            .Select(g => new object[] { g.GetProperty("canonical").GetString()! });

    private const string Sample = "def f(x):\n    # note\n    s = \"a'b\\\"c\" + 'd' + `e`\n    /* block\n    spans */ return x // 12.5e3 -- sql\n\t'''doc''' $ @ é 中\n";

    [Theory, MemberData(nameof(Kinds))]
    public void Coloured_tokens_match_the_table(string name, string json)
    {
        var c = Fx.Parse(json);

        var tokens = SyntaxHighlighter.Tokenize(c.GetProperty("language").GetString(), c.GetProperty("source").GetString()!);

        var actual = tokens.Where(t => t.Kind != TokenKind.Plain).Select(t => (t.Kind.ToString().ToLowerInvariant(), t.Text));
        var expected = c.GetProperty("expect").EnumerateArray().Select(e => (e[0].GetString()!, e[1].GetString()!));
        Assert.Equal(expected, actual);
    }

    [Theory, MemberData(nameof(Languages))]
    public void Tokens_always_reassemble_to_the_exact_source(string language)
    {
        var tokens = SyntaxHighlighter.Tokenize(language, Sample);

        Assert.Equal(Sample, string.Concat(tokens.Select(t => t.Text)));
    }

    [Fact]
    public void An_unterminated_string_or_comment_still_reassembles_and_empty_source_has_no_tokens()
    {
        var source = "x = \"open\n/* never closed";

        var tokens = SyntaxHighlighter.Tokenize("typescript", source);

        Assert.Equal(source, string.Concat(tokens.Select(t => t.Text)));
        Assert.Empty(SyntaxHighlighter.Tokenize("python", ""));
    }
}
