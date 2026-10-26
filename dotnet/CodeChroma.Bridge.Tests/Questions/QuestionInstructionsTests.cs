using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Tests.Contract;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionInstructionsTests
{
    [Fact]
    public void InstructionsMatchTheSharedContractText()
    {
        var shared = File.ReadAllText(Path.Combine(ContractCases.FixtureDir, "mcp_instructions.txt"));

        Assert.Equal(shared, QuestionMcp.Instructions);
    }
}
