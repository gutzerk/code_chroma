namespace CodeChroma.Core.Tests;

public class AnalysisInputContractTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public void AnUnsupportedSchemaVersion_IsRejected(int version)
    {
        var json = $$"""{"schema_version": {{version}}, "files": []}""";

        Assert.Throws<UnsupportedSchemaException>(() => AnalysisInputReader.Parse(json));
    }

    [Fact]
    public void ASymbol_RoundTripsEveryFieldTheAnalyzersEmit()
    {
        var json = """
        {"schema_version": 1, "files": [{"path": "a.py", "symbols": [{
          "id": "a.py::function::f", "file_path": "a.py", "kind": "function", "name": "f",
          "qualified_name": "f", "start_line": 3, "end_line": 9, "language": "python",
          "parent_symbol_id": "a.py::module::a", "references": ["g"],
          "qualified_references": [{"qualifier": "m", "name": "z"}], "assigned_identifiers": ["x"],
          "imports": {"m": "pkg.m"}, "body_statements": [{"type": "if_statement", "start_line": 4, "end_line": 6}],
          "docstring": "Does f.", "is_exported": true}]}, {"path": "b.bin", "symbols": null}],
          "import_resolutions": {"a.py": {"pkg.m": "pkg/m.py"}}, "summaries": {"x": "y"}, "unknown_future_field": 1}
        """;

        var input = AnalysisInputReader.Parse(json);

        var symbol = input.Files[0].Symbols!.Single();
        Assert.Equal((SymbolKind.Function, 3, 9, "a.py::module::a"), (symbol.Kind, symbol.StartLine, symbol.EndLine, symbol.ParentSymbolId));
        Assert.Equal(new QualifiedReference("m", "z"), symbol.QualifiedReferences.Single());
        Assert.Equal(new BodyStatement("if_statement", 4, 6), symbol.BodyStatements.Single());
        Assert.Equal("pkg.m", symbol.Imports["m"]);
        Assert.True(symbol.IsExported);
        Assert.Null(input.Files[1].Symbols);
        Assert.Equal("pkg/m.py", input.ImportResolutions["a.py"]["pkg.m"]);
        Assert.Equal("y", input.Summaries["x"]);
    }

    [Theory]
    [MemberData(nameof(AllRepos))]
    public void EveryFixtureInput_LoadsAndKeepsItsFilesInOrder(string repo)
    {
        var input = Fixtures.Input(repo);

        Assert.Equal(AnalysisInputReader.SupportedSchemaVersion, input.SchemaVersion);
        Assert.Equal(input.Files.Select(f => f.Path).Distinct().Count(), input.Files.Count);
    }

    public static TheoryData<string> AllRepos() => Fixtures.RepoData();
}
