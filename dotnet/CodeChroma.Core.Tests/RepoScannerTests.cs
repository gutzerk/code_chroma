using CodeChroma.Core.Analyzers;

namespace CodeChroma.Core.Tests;

public class RepoScannerTests
{
    [Theory]
    [InlineData(".agents/skills/codechroma-draw-diagram/SKILL.md", true)]
    [InlineData(".claude/skills/codechroma-c1/scripts/check.py", true)]
    [InlineData(".agents/skills/my-own-skill/SKILL.md", false)]
    [InlineData(".claude/skills", false)]
    [InlineData("src/codechroma-patterns/app.py", false)]
    public void Only_the_bridges_own_skill_copies_count_as_synced(string relative, bool expected)
    {
        Assert.Equal(expected, RepoScanner.IsSyncedSkillPath(relative));
    }
}
