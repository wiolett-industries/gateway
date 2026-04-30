MODULE := github.com/wiolett-industries/gateway/nginx-daemon
SHARED_MODULE := github.com/wiolett-industries/gateway/daemon-shared
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
PROTO_DIR := ../../../proto
SHARED_OUT_DIR := ../shared/gatewayv1
BINARY := bin/nginx-daemon

.PHONY: all build test lint clean proto

all: proto build

proto:
	@mkdir -p $(SHARED_OUT_DIR)
	protoc \
		--proto_path=$(PROTO_DIR) \
		--go_out=$(SHARED_OUT_DIR) \
		--go_opt=module=$(SHARED_MODULE)/gatewayv1 \
		--go-grpc_out=$(SHARED_OUT_DIR) \
		--go-grpc_opt=module=$(SHARED_MODULE)/gatewayv1 \
		gateway/v1/nginx-daemon.proto

build:
	CGO_ENABLED=0 go build -ldflags "-s -w -X $(MODULE)/internal/daemon.Version=$(VERSION)" -o $(BINARY) ./cmd/nginx-daemon

test:
	go test ./...

lint:
	go vet ./...

clean:
	rm -rf bin/
