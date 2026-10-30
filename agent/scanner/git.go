package scanner

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type gitRepoInfo struct {
	repoRoot  string
	originURL string
	found     bool
}

var (
	gitCacheMu sync.RWMutex
	gitCache   = make(map[string]gitRepoInfo) // dir -> gitRepoInfo
)

// NormalizeGitURL 标准化 Git 远程仓库地址（去除协议、认证、.git 后缀，转为小写）
func NormalizeGitURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(raw, ".git")

	for _, prefix := range []string{"https://", "http://", "ssh://", "git://"} {
		if strings.HasPrefix(raw, prefix) {
			raw = strings.TrimPrefix(raw, prefix)
			break
		}
	}

	if atIdx := strings.Index(raw, "@"); atIdx != -1 {
		raw = raw[atIdx+1:]
	}

	raw = strings.ReplaceAll(raw, ":", "/")
	raw = strings.Trim(raw, "/")
	return strings.ToLower(raw)
}

func parseGitConfigOrigin(configPath string) string {
	f, err := os.Open(configPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	inOrigin := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "[") {
			inOrigin = (line == `[remote "origin"]`)
			continue
		}
		if inOrigin && strings.HasPrefix(line, "url") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}

// FindGitRepo 从指定目录向上递归寻找 .git 根目录及 origin 远程地址
func FindGitRepo(dir string) (repoRoot, originURL string, found bool) {
	curr := filepath.Clean(dir)
	for {
		gitPath := filepath.Join(curr, ".git")
		if fi, err := os.Stat(gitPath); err == nil {
			var configPath string
			if fi.IsDir() {
				configPath = filepath.Join(gitPath, "config")
			} else {
				content, err := os.ReadFile(gitPath)
				if err == nil {
					line := strings.TrimSpace(string(content))
					if strings.HasPrefix(line, "gitdir:") {
						gd := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
						if !filepath.IsAbs(gd) {
							gd = filepath.Join(curr, gd)
						}
						configPath = filepath.Join(gd, "config")
					}
				}
			}
			if configPath != "" {
				if origin := parseGitConfigOrigin(configPath); origin != "" {
					return curr, origin, true
				}
			}
			return curr, "", true
		}

		parent := filepath.Dir(curr)
		if parent == curr {
			break
		}
		curr = parent
	}
	return "", "", false
}

// CachedFindGitRepo 带内存缓存的 Git 仓库探测，避免重复递归磁盘 I/O
func CachedFindGitRepo(dir string) (repoRoot, originURL string, found bool) {
	cleanDir := filepath.Clean(dir)

	gitCacheMu.RLock()
	if info, ok := gitCache[cleanDir]; ok {
		gitCacheMu.RUnlock()
		return info.repoRoot, info.originURL, info.found
	}
	gitCacheMu.RUnlock()

	root, origin, ok := FindGitRepo(cleanDir)

	gitCacheMu.Lock()
	gitCache[cleanDir] = gitRepoInfo{
		repoRoot:  root,
		originURL: origin,
		found:     ok,
	}
	gitCacheMu.Unlock()

	return root, origin, ok
}

// DetermineFileIdentity 智能推断文件的跨端全局唯一标识与相对路径
// 1. 若处于 Git 仓库中且有 remote.origin：使用 git:<origin>:<repo_relative_path>，完全免疫本地父目录名与克隆路径差异；
// 2. 若处于本地无 origin 的 Git 仓库：使用 git_local:<repo_name>:<repo_relative_path>；
// 3. 若处于普通目录：使用 local:<folder_name>:<folder_relative_path>。
func DetermineFileIdentity(filePath, folderRoot string) (fileUID, relPath string) {
	cleanPath := filepath.Clean(filePath)
	dir := filepath.Dir(cleanPath)

	if repoRoot, origin, ok := CachedFindGitRepo(dir); ok {
		rel, err := filepath.Rel(repoRoot, cleanPath)
		if err == nil {
			rel = filepath.ToSlash(rel)
			if origin != "" {
				return fmt.Sprintf("git:%s:%s", NormalizeGitURL(origin), rel), rel
			}
			return fmt.Sprintf("git_local:%s:%s", filepath.Base(repoRoot), rel), rel
		}
	}

	cleanFolder := filepath.Clean(folderRoot)
	rel, err := filepath.Rel(cleanFolder, cleanPath)
	if err != nil {
		rel = filepath.Base(cleanPath)
	}
	rel = filepath.ToSlash(rel)
	folderName := filepath.Base(cleanFolder)
	return fmt.Sprintf("local:%s:%s", folderName, rel), rel
}
