package main

import (
	"os"
	"sync"
)

type rotWriter struct {
	mu   sync.Mutex
	path string
	f    *os.File
	size int64
}

const maxLog = 5 << 20

func newRotWriter(path string) (*rotWriter, error) {
	w := &rotWriter{path: path}
	return w, w.open()
}

func (w *rotWriter) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	fi, _ := f.Stat()
	if fi != nil {
		w.f, w.size = f, fi.Size()
	} else {
		w.f, w.size = f, 0
	}
	return nil
}

func (w *rotWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.size+int64(len(p)) > maxLog {
		if w.f != nil {
			_ = w.f.Close()
		}
		_ = os.Rename(w.path, w.path+".1") // 只保留一份历史
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	n, err := w.f.Write(p)
	w.size += int64(n)
	return n, err
}
