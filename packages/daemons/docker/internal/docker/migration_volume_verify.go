package docker

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

func migrationInodeKey(stat *syscall.Stat_t) string {
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
}

func safeMigrationArchiveLink(root, name string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(name))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("unsafe migration archive hard link")
	}
	target := filepath.Join(root, clean)
	if err := ensureMigrationParentsSafe(root, target); err != nil {
		return "", err
	}
	info, err := os.Lstat(target)
	if err != nil {
		return "", fmt.Errorf("inspect migration archive hard link target: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("migration archive hard link target is not a regular file")
	}
	return target, nil
}

func ensureMigrationParentsSafe(root, target string) error {
	rel, err := filepath.Rel(root, filepath.Dir(target))
	if err != nil || rel == ".." || filepath.IsAbs(rel) {
		return fmt.Errorf("unsafe migration archive parent")
	}
	current := root
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "." || part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect migration archive parent: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("migration archive parent is not a directory")
		}
	}
	return nil
}

func verifyMigrationMetadata(root string, expected []migrationVolumeEntry) error {
	actual := make([]migrationVolumeEntry, 0, len(expected))
	hardlinks := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || path == root {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		kind, err := migrationEntryKind(info.Mode())
		if err != nil {
			return err
		}
		stat := info.Sys().(*syscall.Stat_t)
		link := ""
		if kind == 'l' {
			link, err = os.Readlink(path)
			if err != nil {
				return err
			}
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if kind == 'f' && stat.Nlink > 1 {
			key := migrationInodeKey(stat)
			if first, ok := hardlinks[key]; ok {
				kind = 'h'
				link = first
			} else {
				hardlinks[key] = rel
			}
		}
		size := int64(0)
		if kind == 'f' {
			size = info.Size()
		}
		mode := uint32(info.Mode().Perm())
		if kind == 'l' {
			mode = 0777
		}
		actual = append(actual, migrationVolumeEntry{Path: rel, Kind: kind, Mode: mode, UID: int(stat.Uid), GID: int(stat.Gid), ModTime: info.ModTime().UnixNano(), Size: size, Link: link})
		return nil
	})
	if err != nil {
		return fmt.Errorf("verify target volume metadata: %w", err)
	}
	sort.Slice(expected, func(i, j int) bool { return expected[i].Path < expected[j].Path })
	sort.Slice(actual, func(i, j int) bool { return actual[i].Path < actual[j].Path })
	if len(actual) != len(expected) {
		return fmt.Errorf("target volume metadata entry count mismatch")
	}
	for i := range expected {
		if actual[i] != expected[i] {
			return fmt.Errorf("target volume metadata mismatch for %s", expected[i].Path)
		}
	}
	return nil
}

func fsyncMigrationTree(root string) error {
	var dirs []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			dirs = append(dirs, path)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("walk target volume for fsync: %w", err)
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		dir, err := os.Open(dirs[i])
		if err != nil {
			return fmt.Errorf("open target volume directory for fsync: %w", err)
		}
		err = dir.Sync()
		_ = dir.Close()
		if err != nil {
			return fmt.Errorf("fsync target volume directory: %w", err)
		}
	}
	return nil
}
