MODULE := github.com/wiolett/gateway/docker-daemon
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
BINARY := bin/docker-daemon

.PHONY: all build test clean

all: build

build:
	CGO_ENABLED=0 go build -ldflags "-s -w -X main.Version=$(VERSION)" -o $(BINARY) ./cmd/docker-daemon

test:
	go test ./...

clean:
	rm -rf bin/
