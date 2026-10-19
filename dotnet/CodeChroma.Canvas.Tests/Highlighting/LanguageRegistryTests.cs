namespace CodeChroma.Canvas.Tests.Highlighting;

/// <summary>
/// highlighting/registry.test.ts widened to every alias. The per-language Prism token tests (go/yaml/python/jsx
/// "classifies tokens" and "reassembles to the original source") test a third-party library and are replaced by the
/// TextMate-grammar contract that belongs to the Avalonia view project.
/// </summary>
public class LanguageRegistryTests
{
    public static IEnumerable<object[]> Aliases =>
        Fx.Load("highlighter_aliases.json").GetProperty("aliases").EnumerateArray()
            .SelectMany(group => group.GetProperty("aliases").EnumerateArray()
                .Select(alias => new object[] { alias.GetString()!, group.GetProperty("canonical").GetString()! }));

    [Theory, MemberData(nameof(Aliases))]
    public void An_alias_resolves_to_its_canonical_language_case_insensitively(string alias, string canonical)
    {
        Assert.Equal(canonical, LanguageRegistry.Resolve(alias));
        Assert.Equal(canonical, LanguageRegistry.Resolve(alias.ToUpperInvariant()));
    }

    [Fact]
    public void A_missing_language_falls_back_to_plain_text()
    {
        Assert.Equal("plaintext", LanguageRegistry.Resolve(null));
    }

    [Fact]
    public void Every_canonical_language_has_a_textmate_scope_for_the_view()
    {
        var canonicals = Fx.Load("highlighter_aliases.json").GetProperty("aliases").EnumerateArray()
            .Select(g => g.GetProperty("canonical").GetString()!).Where(c => c != "plaintext");

        Assert.All(canonicals, c => Assert.Matches(@"^(source|text)\.", LanguageRegistry.TextMateScope(c)));
    }
}
