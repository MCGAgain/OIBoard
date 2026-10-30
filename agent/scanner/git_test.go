package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeGitURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://github.com/MCGAgain/OIBoard.git", "github.com/mcgagain/oiboard"},
		{"git@github.com:MCGAgain/OIBoard.git", "github.com/mcgagain/oiboard"},
		{"http://gitlab.com/user/project.git", "gitlab.com/user/project"},
		{"ssh://git@gitee.com/user/repo.git", "gitee.com/user/repo"},
	}

	for _, tc := range tests {
		got := NormalizeGitURL(tc.input)
		if got != tc.expected {
			t.Errorf("NormalizeGitURL(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestDetermineFileIdentity(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "git-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Case 1: Non-git folder
	plainFile := filepath.Join(tmpDir, "test.cpp")
	_ = os.WriteFile(plainFile, []byte("int main(){}\n"), 0644)
	fileUID, rel := DetermineFileIdentity(plainFile, tmpDir)
	if rel != "test.cpp" {
		t.Errorf("expected rel test.cpp, got %s", rel)
	}
	expectedUID := "local:" + filepath.Base(tmpDir) + ":test.cpp"
	if fileUID != expectedUID {
		t.Errorf("expected fileUID %s, got %s", expectedUID, fileUID)
	}

	// Case 2: Git repo with origin
	gitDir := filepath.Join(tmpDir, ".git")
	_ = os.MkdirAll(gitDir, 0755)
	configContent := `[core]
	repositoryformatversion = 0
[remote "origin"]
	url = https://github.com/TestUser/AlgorithmPractice.git
`
	_ = os.WriteFile(filepath.Join(gitDir, "config"), []byte(configContent), 0644)

	// Subdir file
	subDir := filepath.Join(tmpDir, "codeforces")
	_ = os.MkdirAll(subDir, 0755)
	codeFile := filepath.Join(subDir, "1000A.cpp")
	_ = os.WriteFile(codeFile, []byte("int main(){}\n"), 0644)

	// Invalidate cache for new test path
	gitCacheMu.Lock()
	gitCache = make(map[string]gitRepoInfo)
	gitCacheMu.Unlock()

	gitUID, gitRel := DetermineFileIdentity(codeFile, subDir)
	expectedGitRel := "codeforces/1000A.cpp"
	expectedGitUID := "git:github.com/testuser/algorithmpractice:codeforces/1000A.cpp"

	if gitRel != expectedGitRel {
		t.Errorf("expected gitRel %s, got %s", expectedGitRel, gitRel)
	}
	if gitUID != expectedGitUID {
		t.Errorf("expected gitUID %s, got %s", expectedGitUID, gitUID)
	}
}
